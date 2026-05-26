// Project/App: gsd-pi
// File Purpose: Extracted from interactive-selectors-session.ts (Phase E2 seam remediation).
// @ts-nocheck

import type { OAuthProviderId } from "@gsd/pi-ai";
import { getAuthPath } from "@gsd/pi-coding-agent/config.js";
import { LoginDialogComponent } from "./components/login-dialog.js";
import { OAuthSelectorComponent } from "./components/oauth-selector.js";
import type { InteractiveModeDelegateHost } from "./interactive-mode-delegate-host.js";

export async function showOAuthSelector(host: InteractiveModeDelegateHost, mode: "login" | "logout"): Promise<void> {
	if (mode === "logout") {
		const providers = host.session.modelRegistry.authStorage.list();
		const loggedInProviders = providers.filter(
			(p) => host.session.modelRegistry.authStorage.get(p)?.type === "oauth",
		);
		if (loggedInProviders.length === 0) {
			host.showStatus("No OAuth providers logged in. Use /login first.");
			return;
		}
	}

	host.showSelector((done) => {
		const selector = new OAuthSelectorComponent(
			mode,
			host.session.modelRegistry.authStorage,
			(providerId: string) => {
				done();

				const handleAsync = async () => {
					if (mode === "login") {
						await host.showLoginDialog(providerId);
					} else {
						const providerInfo = host.session.modelRegistry.authStorage
							.getOAuthProviders()
							.find((p) => p.id === providerId);
						const providerName = providerInfo?.name || providerId;

						try {
							host.session.modelRegistry.authStorage.logout(providerId);
							host.session.modelRegistry.refresh();
							await host.updateAvailableProviderCount();

							const currentModel = host.session.model;
							if (currentModel?.provider === providerId) {
								try {
									const available = host.session.modelRegistry.getAvailable();
									const fallback = available.find((m) => m.provider !== providerId);
									if (fallback) {
										await host.session.setModel(fallback);
									}
								} catch {
									// Model switch failed — user can manually switch via /model
								}
							}

							host.showStatus(`Logged out of ${providerName}`);
						} catch (error: unknown) {
							host.showError(`Logout failed: ${error instanceof Error ? error.message : String(error)}`);
						}
					}
				};
				handleAsync().catch(() => {
					// Swallow — showLoginDialog already handles its own errors.
				});
			},
			() => {
				done();
				host.ui.requestRender();
			},
		);
		return { component: selector, focus: selector };
	});
}

export async function showLoginDialog(host: InteractiveModeDelegateHost, providerId: string): Promise<void> {
	const providerInfo = host.session.modelRegistry.authStorage.getOAuthProviders().find((p) => p.id === providerId);
	const providerName = providerInfo?.name || providerId;
	const usesCallbackServer = providerInfo?.usesCallbackServer ?? false;

	const dialog = new LoginDialogComponent(host.ui, providerId, (_success, _message) => {});

	host.editorContainer.clear();
	host.editorContainer.addChild(dialog);
	host.ui.setFocus(dialog);
	host.ui.requestRender();

	const restoreEditor = () => {
		dialog.dispose();
		host.editorContainer.clear();
		host.editorContainer.addChild(host.editor);
		host.ui.setFocus(host.editor);
		host.ui.requestRender();
	};

	try {
		await host.session.modelRegistry.authStorage.login(providerId as OAuthProviderId, {
			onAuth: (info: { url: string; instructions?: string }) => {
				dialog.showAuth(info.url, info.instructions);

				if (!usesCallbackServer && providerId === "github-copilot") {
					dialog.showWaiting("Waiting for browser authentication...");
				}
			},

			onPrompt: async (prompt: { message: string; placeholder?: string }) => {
				return dialog.showPrompt(prompt.message, prompt.placeholder);
			},

			onProgress: (message: string) => {
				dialog.showProgress(message);
			},

			onManualCodeInput: usesCallbackServer
				? () => dialog.showManualInput("Paste redirect URL below, or complete login in browser:")
				: undefined,

			onDeviceCode: async () => "",
			onSelect: async (prompt) => prompt.options[0]?.id,

			signal: dialog.signal,
		});

		restoreEditor();
		host.session.modelRegistry.refresh();
		await host.updateAvailableProviderCount();

		try {
			const currentModel = host.session.model;
			if (currentModel) {
				const currentKey = await host.session.modelRegistry.getApiKey(currentModel);
				if (!currentKey) {
					const available = host.session.modelRegistry.getAvailable();
					const newProviderModel = available.find((m) => m.provider === providerId);
					if (newProviderModel) {
						await host.session.setModel(newProviderModel);
					} else if (available.length > 0) {
						await host.session.setModel(available[0]);
					}
				}
			}
		} catch {
			// Model switch failed — user can manually switch via /model
		}

		host.showStatus(`Logged in to ${providerName}. Credentials saved to ${getAuthPath()}`);
	} catch (error: unknown) {
		restoreEditor();
		const errorMsg = error instanceof Error ? error.message : String(error);
		if (errorMsg !== "Login cancelled" && !errorMsg.includes("Superseded") && !errorMsg.includes("disposed")) {
			host.showError(`Failed to login to ${providerName}: ${errorMsg}`);
		}
	}
}

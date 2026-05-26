// Project/App: gsd-pi
// File Purpose: Extracted from interactive-extension-widgets.ts (Phase E2 seam remediation).
// @ts-nocheck

import type { KeyId } from "@gsd/pi-tui";
import { matchesKey } from "@gsd/pi-tui";
import type { ExtensionContext, ExtensionRunner } from "@gsd/pi-coding-agent/core/extensions/index.js";
import type { InteractiveModeDelegateHost } from "./interactive-mode-delegate-host.js";

export function getRegisteredToolDefinition(host: InteractiveModeDelegateHost, toolName: string) {
	return host.session.getRenderableToolDefinition(toolName);
}

export function formatWebSearchResult(_host: InteractiveModeDelegateHost, content: unknown): string {
	if (!content) return "Web search completed";

	if (typeof content === "object" && "type" in (content as any) && (content as any).type === "web_search_tool_result_error") {
		const error = content as any;
		return `Search error: ${error.error_code || "unknown"}`;
	}

	if (Array.isArray(content)) {
		const results = content.filter((r: any) => r.type === "web_search_result");
		if (results.length === 0) return "No results found";
		return results
			.map((r: any) => {
				const title = r.title || "Untitled";
				const url = r.url || "";
				return `${title}\n  ${url}`;
			})
			.join("\n");
	}

	return "Web search completed";
}

export function setupExtensionShortcuts(host: InteractiveModeDelegateHost, extensionRunner: ExtensionRunner): void {
	const shortcuts = extensionRunner.getShortcuts(host.keybindings.getEffectiveConfig());
	if (shortcuts.size === 0) return;

	const createContext = (): ExtensionContext => ({
		ui: host.createExtensionUIContext(),
		hasUI: true,
		cwd: process.cwd(),
		sessionManager: host.sessionManager,
		modelRegistry: host.session.modelRegistry,
		model: host.session.model,
		signal: host.session.agent.signal,
		isIdle: () => !host.session.isStreaming,
		abort: () => host.session.abort(),
		hasPendingMessages: () => host.session.pendingMessageCount > 0,
		shutdown: () => {
			host.shutdownRequested = true;
		},
		getContextUsage: () => host.session.getContextUsage(),
		compact: (options) => {
			void (async () => {
				try {
					const result = await host.executeCompaction(options?.customInstructions, false);
					if (result) {
						options?.onComplete?.(result);
					}
				} catch (error) {
					const err = error instanceof Error ? error : new Error(String(error));
					options?.onError?.(err);
				}
			})();
		},
		getSystemPrompt: () => host.session.systemPrompt,
		setCompactionThresholdOverride: (percent) => {
			host.session.settingsManager.setCompactionThresholdOverride(percent);
		},
	});

	host.defaultEditor.onExtensionShortcut = (data: string) => {
		for (const [shortcutStr, shortcut] of shortcuts) {
			if (matchesKey(data, shortcutStr as KeyId)) {
				Promise.resolve(shortcut.handler(createContext())).catch((err) => {
					host.showError(`Shortcut handler error: ${err instanceof Error ? err.message : String(err)}`);
				});
				return true;
			}
		}
		return false;
	};
}

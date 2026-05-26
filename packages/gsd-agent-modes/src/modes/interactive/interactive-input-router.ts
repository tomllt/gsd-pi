// Project/App: gsd-pi
// File Purpose: Extracted from interactive-mode.ts (Phase E2 seam remediation).

import { BUILTIN_SLASH_COMMANDS } from "@gsd/pi-coding-agent/core/slash-commands.js";
import { Spacer, TruncatedText } from "@gsd/pi-tui";
import { theme } from "@gsd/pi-coding-agent/theme/theme.js";
import { getAppKeyDisplay, type SlashCommandContext } from "./slash-command-handlers.js";
import type { InteractiveModeDelegateHost } from "./interactive-mode-delegate-host.js";
import type { CompactionQueuedMessage } from "./interactive-notify-render.js";
import type { PromptTemplate } from "@gsd/pi-coding-agent/core/prompt-templates.js";
import type { Skill } from "@gsd/pi-coding-agent/core/skills.js";

export { setupAutocomplete } from "./interactive-autocomplete.js";

export function getSlashCommandContext(host: InteractiveModeDelegateHost): SlashCommandContext {
		return {
			session: host.session,
			ui: host.ui,
			keybindings: host.keybindings,
			chatContainer: host.chatContainer,
			statusContainer: host.statusContainer,
			editorContainer: host.editorContainer,
			headerContainer: host.headerContainer,
			pendingMessagesContainer: host.pendingMessagesContainer,
			editor: host.editor,
			defaultEditor: host.defaultEditor,
			sessionManager: host.sessionManager,
			settingsManager: host.settingsManager,
			invalidateFooter: () => host.footer.invalidate(),
			showStatus: (msg) => host.showStatus(msg),
			showError: (msg) => host.showError(msg),
			showWarning: (msg) => host.showWarning(msg),
			showSelector: (create) => host.showSelector(create),
			updateEditorBorderColor: () => host.updateEditorBorderColor(),
			getMarkdownThemeWithSettings: () => host.getMarkdownThemeWithSettings(),
			requestRender: () => host.ui.requestRender(),
			updateTerminalTitle: () => host.updateTerminalTitle(),
			showSettingsSelector: () => host.showSettingsSelector(),
			showModelsSelector: () => host.showModelsSelector(),
			handleModelCommand: (searchTerm) => host.handleModelCommand(searchTerm),
			showUserMessageSelector: () => host.showUserMessageSelector(),
			showTreeSelector: () => host.showTreeSelector(),
			showProviderManager: () => host.showProviderManager(),
			showOAuthSelector: (mode) => host.showOAuthSelector(mode),
			showSessionSelector: () => host.showSessionSelector(),
			handleClearCommand: () => host.handleClearCommand(),
			handleReloadCommand: () => host.handleReloadCommand(),
			handleDebugCommand: () => host.handleDebugCommand(),
			shutdown: () => host.shutdown(),
			executeCompaction: (instructions, isAuto) => host.executeCompaction(instructions, isAuto),
			handleBashCommand: (command, options) => host.handleBashCommand(command, options?.excludeFromContext, options?.displayCommand, options?.loginShell),
		};
	}

export function getAllQueuedMessages(host: InteractiveModeDelegateHost): { steering: string[]; followUp: string[] } {
		return {
			steering: [
				...host.session.getSteeringMessages(),
				...host.compactionQueuedMessages.filter((msg: CompactionQueuedMessage) => msg.mode === "steer").map((msg: CompactionQueuedMessage) => msg.text),
			],
			followUp: [
				...host.session.getFollowUpMessages(),
				...host.compactionQueuedMessages.filter((msg: CompactionQueuedMessage) => msg.mode === "followUp").map((msg: CompactionQueuedMessage) => msg.text),
			],
		};
	}

	/**
	 * Clear all queued messages and return their contents.
	 * Clears both session queue and compaction queue.
	 */
export function clearAllQueues(host: InteractiveModeDelegateHost): { steering: string[]; followUp: string[] } {
		const { steering, followUp } = host.session.clearQueue();
		const compactionSteering = host.compactionQueuedMessages
			.filter((msg: CompactionQueuedMessage) => msg.mode === "steer")
			.map((msg: CompactionQueuedMessage) => msg.text);
		const compactionFollowUp = host.compactionQueuedMessages
			.filter((msg: CompactionQueuedMessage) => msg.mode === "followUp")
			.map((msg: CompactionQueuedMessage) => msg.text);
		host.compactionQueuedMessages = [];
		return {
			steering: [...steering, ...compactionSteering],
			followUp: [...followUp, ...compactionFollowUp],
		};
	}

export function updatePendingMessagesDisplay(host: InteractiveModeDelegateHost): void {
		host.pendingMessagesContainer.clear();
		const { steering: steeringMessages, followUp: followUpMessages } = getAllQueuedMessages(host);
		if (steeringMessages.length > 0 || followUpMessages.length > 0) {
			host.pendingMessagesContainer.addChild(new Spacer(1));
			for (const message of steeringMessages) {
				const text = theme.fg("dim", `Steering: ${message}`);
				host.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
			}
			for (const message of followUpMessages) {
				const text = theme.fg("dim", `Follow-up: ${message}`);
				host.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
			}
			const dequeueHint = getAppKeyDisplay(host.keybindings, "dequeue");
			const hintText = theme.fg("dim", `↳ ${dequeueHint} to edit all queued messages`);
			host.pendingMessagesContainer.addChild(new TruncatedText(hintText, 1, 0));
		}
	}

export function restoreQueuedMessagesToEditor(host: InteractiveModeDelegateHost, options?: { abort?: boolean; currentText?: string }): number {
		const { steering, followUp } = clearAllQueues(host);
		const allQueued = [...steering, ...followUp];
		if (allQueued.length === 0) {
			host.updatePendingMessagesDisplay();
			if (options?.abort) {
				host.agent.abort();
			}
			return 0;
		}
		const queuedText = allQueued.join("\n\n");
		const currentText = options?.currentText ?? host.editor.getText();
		const combinedText = [queuedText, currentText].filter((t) => t.trim()).join("\n\n");
		host.editor.setText(combinedText);
		host.updatePendingMessagesDisplay();
		if (options?.abort) {
				host.agent.abort();
		}
		return allQueued.length;
	}

export function queueCompactionMessage(host: InteractiveModeDelegateHost, text: string, mode: "steer" | "followUp"): void {
		if (text.startsWith("/") && !host.isKnownSlashCommand(text)) {
			const command = text.split(/\s/)[0];
			host.showError(`Unknown command: ${command}. Use slash autocomplete to see available commands.`);
			return;
		}

		host.compactionQueuedMessages.push({ text, mode });
		host.editor.addToHistory?.(text);
		host.editor.setText("");
		host.updatePendingMessagesDisplay();
		host.showStatus("Queued message for after compaction");
	}

export function isExtensionCommand(host: InteractiveModeDelegateHost, text: string): boolean {
		if (!text.startsWith("/")) return false;

		const extensionRunner = host.session.extensionRunner;
		if (!extensionRunner) return false;

		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		return !!extensionRunner.getCommand(commandName);
	}

export function isKnownSlashCommand(host: InteractiveModeDelegateHost, text: string): boolean {
		if (!text.startsWith("/")) return false;

		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);

		if (BUILTIN_SLASH_COMMANDS.some((command) => command.name === commandName)) {
			return true;
		}

		if (isExtensionCommand(host, text)) {
			return true;
		}

		if (host.session.promptTemplates.some((template: PromptTemplate) => template.name === commandName)) {
			return true;
		}

		if (commandName.startsWith("skill:") && host.settingsManager.getEnableSkillCommands()) {
			const skillName = commandName.slice("skill:".length);
			return host.session.resourceLoader.getSkills().skills.some((skill: Skill) => skill.name === skillName);
		}

		return false;
	}

export async function flushCompactionQueue(host: InteractiveModeDelegateHost, options?: { willRetry?: boolean }): Promise<void> {
		if (host.compactionQueuedMessages.length === 0) {
			return;
		}

		const queuedMessages = [...host.compactionQueuedMessages];
		host.compactionQueuedMessages = [];
		host.updatePendingMessagesDisplay();

		const restoreQueue = (error: unknown) => {
			host.session.clearQueue();
			host.compactionQueuedMessages = queuedMessages;
			host.updatePendingMessagesDisplay();
			host.showError(
				`Failed to send queued message${queuedMessages.length > 1 ? "s" : ""}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		};

		try {
			if (options?.willRetry) {
				// When retry is pending, queue messages for the retry turn
				for (const message of queuedMessages) {
					if (isExtensionCommand(host, message.text)) {
						await host.session.prompt(message.text);
					} else if (message.mode === "followUp") {
						await host.session.followUp(message.text);
					} else {
						await host.session.steer(message.text);
					}
				}
				host.updatePendingMessagesDisplay();
				return;
			}

			// Find first non-extension-command message to use as prompt
			const firstPromptIndex = queuedMessages.findIndex((message) => !isExtensionCommand(host, message.text));
			if (firstPromptIndex === -1) {
				// All extension commands - execute them all
				for (const message of queuedMessages) {
					await host.session.prompt(message.text);
				}
				return;
			}

			// Execute any extension commands before the first prompt
			const preCommands = queuedMessages.slice(0, firstPromptIndex);
			const firstPrompt = queuedMessages[firstPromptIndex];
			const rest = queuedMessages.slice(firstPromptIndex + 1);

			for (const message of preCommands) {
				await host.session.prompt(message.text);
			}

			// Send first prompt (starts streaming)
			const promptPromise = host.session.prompt(firstPrompt.text).catch((error: unknown) => {
				restoreQueue(error);
			});

			// Queue remaining messages
			for (const message of rest) {
				if (isExtensionCommand(host, message.text)) {
					await host.session.prompt(message.text);
				} else if (message.mode === "followUp") {
					await host.session.followUp(message.text);
				} else {
					await host.session.steer(message.text);
				}
			}
			host.updatePendingMessagesDisplay();
			void promptPromise;
		} catch (error) {
			restoreQueue(error);
		}
	}

	/** Move pending bash components from pending area to chat */
export function flushPendingBashComponents(host: InteractiveModeDelegateHost): void {
		for (const component of host.pendingBashComponents) {
			host.pendingMessagesContainer.removeChild(component);
			host.chatContainer.addChild(component);
		}
		host.pendingBashComponents = [];
	}

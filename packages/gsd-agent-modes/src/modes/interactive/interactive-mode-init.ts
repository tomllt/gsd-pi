// Project/App: gsd-pi
// File Purpose: Extracted from interactive-mode.ts (Phase E2 seam remediation).
// @ts-nocheck

import * as path from "node:path";
import { Markdown, Spacer, Text } from "@gsd/pi-tui";
import { APP_NAME } from "@gsd/pi-coding-agent/config.js";
import type { AppAction } from "@gsd/agent-core";
import { theme } from "@gsd/pi-coding-agent/theme/theme.js";
import { appKey, appKeyHint, keyHint, rawKeyHint } from "./components/keybinding-hints.js";
import { DynamicBorder } from "./components/dynamic-border.js";
import { getToolExpansionStartupHint } from "./interactive-notify-render.js";
import { getChangelogForDisplay } from "./interactive-startup.js";
import { getMarkdownThemeWithSettings } from "./interactive-theme-cache.js";
import type { InteractiveModeDelegateHost } from "./interactive-mode-delegate-host.js";

export { getChangelogForDisplay, checkForNewVersion, checkTmuxKeyboardSetup } from "./interactive-startup.js";

export function installStdinErrorRecovery(host: InteractiveModeDelegateHost): void {
	if (host.stdinErrorHandler) return;
	host.stdinErrorHandler = (err: Error) => {
		const errno = err as NodeJS.ErrnoException;
		const isReadEio = errno.code === "EIO" || /read EIO/i.test(err.message);
		if (!isReadEio) return;

		process.stderr.write(`[pi] stdin EIO detected, aborting active stream\n`);
		if (host.session.isStreaming) {
			host.agent.abort();
			host.showWarning("Terminal input was interrupted (EIO). Aborted the active response; send your message again.");
		}
	};
	process.stdin.on("error", host.stdinErrorHandler);
}

export function mountStartupHeader(host: InteractiveModeDelegateHost): void {
	if (host.options.verbose || !host.settingsManager.getQuietStartup()) {
		const logo = theme.bold(theme.fg("accent", APP_NAME)) + theme.fg("dim", ` v${host.version}`);

		const kb = host.keybindings;
		const hint = (action: AppAction, desc: string) => appKeyHint(kb, action, desc);

		const instructions = [
			hint("interrupt", "to interrupt"),
			hint("clear", "to clear"),
			rawKeyHint(`${appKey(kb, "clear")} twice`, "to exit"),
			hint("exit", "to exit (empty)"),
			hint("suspend", "to suspend"),
			keyHint("deleteToLineEnd", "to delete to end"),
			hint("cycleThinkingLevel", "to cycle thinking level"),
			rawKeyHint(`${appKey(kb, "cycleModelForward")}/${appKey(kb, "cycleModelBackward")}`, "to cycle models"),
			hint("selectModel", "to select model"),
			getToolExpansionStartupHint(host.toolOutputExpanded, kb),
			hint("toggleThinking", "to expand thinking"),
			hint("externalEditor", "for external editor"),
			rawKeyHint("/", "for commands"),
			rawKeyHint("!", "to run bash"),
			rawKeyHint("!!", "to run bash (no context)"),
			hint("followUp", "to queue follow-up"),
			hint("dequeue", "to edit all queued messages"),
			hint("pasteImage", "to paste image"),
			rawKeyHint("drop files", "to attach"),
		].join("\n");
		host.builtInHeader = new Text(`${logo}\n${instructions}`, 1, 0);

		host.headerContainer.addChild(new Spacer(1));
		host.headerContainer.addChild(host.builtInHeader);
		host.headerContainer.addChild(new Spacer(1));

		if (host.changelogMarkdown) {
			host.headerContainer.addChild(new DynamicBorder());
			if (host.settingsManager.getCollapseChangelog()) {
				const versionMatch = host.changelogMarkdown.match(/##\s+\[?(\d+\.\d+\.\d+)\]?/);
				const latestVersion = versionMatch ? versionMatch[1] : host.version;
				const condensedText = `Updated to v${latestVersion}. Use ${theme.bold("/changelog")} to view full changelog.`;
				host.headerContainer.addChild(new Text(condensedText, 1, 0));
			} else {
				host.headerContainer.addChild(new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0));
				host.headerContainer.addChild(new Spacer(1));
				host.headerContainer.addChild(
					new Markdown(host.changelogMarkdown.trim(), 1, 0, getMarkdownThemeWithSettings(host)),
				);
				host.headerContainer.addChild(new Spacer(1));
			}
			host.headerContainer.addChild(new DynamicBorder());
		}
	} else {
		host.builtInHeader = new Text("", 0, 0);
		host.headerContainer.addChild(host.builtInHeader);
		if (host.changelogMarkdown) {
			host.headerContainer.addChild(new Spacer(1));
			const versionMatch = host.changelogMarkdown.match(/##\s+\[?(\d+\.\d+\.\d+)\]?/);
			const latestVersion = versionMatch ? versionMatch[1] : host.version;
			const condensedText = `Updated to v${latestVersion}. Use ${theme.bold("/changelog")} to view full changelog.`;
			host.headerContainer.addChild(new Text(condensedText, 1, 0));
		}
	}
}

export function updateTerminalTitle(host: InteractiveModeDelegateHost): void {
	const cwdBasename = path.basename(process.cwd());
	const sessionName = host.sessionManager.getSessionName();
	if (sessionName) {
		host.ui.terminal.setTitle(`π - ${sessionName} - ${cwdBasename}`);
	} else {
		host.ui.terminal.setTitle(`π - ${cwdBasename}`);
	}
}

export { showNewVersionNotification } from "./interactive-ui-messaging.js";

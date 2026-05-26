// Project/App: gsd-pi
// File Purpose: Extracted from interactive-mode.ts (Phase E2 seam remediation).

import { Spacer, Text } from "@gsd/pi-tui";
import { getUpdateInstruction } from "@gsd/pi-coding-agent/config.js";
import { theme } from "@gsd/pi-coding-agent/theme/theme.js";
import { DynamicBorder } from "./components/dynamic-border.js";
import { renderBlockingErrorBanner } from "./interactive-notify-render.js";
import type { InteractiveModeDelegateHost } from "./interactive-mode-delegate-host.js";

export function clearEditor(host: InteractiveModeDelegateHost): void {
	host.editor.setText("");
	host.ui.requestRender();
}

export function showError(host: InteractiveModeDelegateHost, errorMessage: string): void {
	host.lastBlockingError = errorMessage;
	renderBlockingErrorBanner(host.blockingErrorContainer, host.lastBlockingError);
	host.chatContainer.addChild(new Spacer(1));
	host.chatContainer.addChild(new Text(theme.fg("error", `Error: ${errorMessage}`), 1, 0));
	host.ui.requestRender();
}

export function clearBlockingError(host: InteractiveModeDelegateHost): void {
	host.lastBlockingError = undefined;
	renderBlockingErrorBanner(host.blockingErrorContainer, undefined);
	host.ui.requestRender();
}

export function showWarning(host: InteractiveModeDelegateHost, warningMessage: string): void {
	host.chatContainer.addChild(new Spacer(1));
	host.chatContainer.addChild(new Text(theme.fg("warning", `Warning: ${warningMessage}`), 1, 0));
	host.ui.requestRender();
}

export function showSuccess(host: InteractiveModeDelegateHost, successMessage: string): void {
	host.chatContainer.addChild(new Spacer(1));
	host.chatContainer.addChild(new DynamicBorder((text) => theme.fg("success", text)));
	host.chatContainer.addChild(new Text(theme.fg("success", successMessage), 1, 0));
	host.chatContainer.addChild(new DynamicBorder((text) => theme.fg("success", text)));
	host.chatContainer.addChild(new Spacer(1));
	host.ui.requestRender();
}

export function showTip(host: InteractiveModeDelegateHost, message: string): void {
	host.chatContainer.addChild(new Spacer(1));
	host.chatContainer.addChild(new Text(theme.fg("dim", `💡 ${message}`), 1, 0));
	host.ui.requestRender();
}

export function showNewVersionNotification(host: InteractiveModeDelegateHost, newVersion: string): void {
	const action = theme.fg("accent", getUpdateInstruction("@gsd/pi-coding-agent"));
	const updateInstruction = theme.fg("muted", `New version ${newVersion} is available. `) + action;
	const changelogUrl = theme.fg(
		"accent",
		"https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/CHANGELOG.md",
	);
	const changelogLine = theme.fg("muted", "Changelog: ") + changelogUrl;

	host.chatContainer.addChild(new Spacer(1));
	host.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
	host.chatContainer.addChild(
		new Text(
			`${theme.bold(theme.fg("warning", "Update Available"))}\n${updateInstruction}\n${changelogLine}`,
			1,
			0,
		),
	);
	host.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
	host.ui.requestRender();
}

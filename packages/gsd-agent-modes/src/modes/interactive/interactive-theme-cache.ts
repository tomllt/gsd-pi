// Project/App: gsd-pi
// File Purpose: Extracted from interactive-mode.ts (Phase E2 seam remediation).
// @ts-nocheck

import type { MarkdownTheme } from "@gsd/pi-tui";
import { getMarkdownTheme } from "@gsd/pi-coding-agent/theme/theme.js";
import type { InteractiveModeDelegateHost } from "./interactive-mode-delegate-host.js";

export function getMarkdownThemeWithSettings(host: InteractiveModeDelegateHost): MarkdownTheme {
	const codeBlockIndent = host.settingsManager.getCodeBlockIndent();
	if (host.markdownThemeCache && host.markdownThemeCacheIndent === codeBlockIndent) {
		return host.markdownThemeCache;
	}

	host.markdownThemeCacheIndent = codeBlockIndent;
	host.markdownThemeCache = {
		...getMarkdownTheme(),
		codeBlockIndent,
	};
	return host.markdownThemeCache;
}

export function clearMarkdownThemeCache(host: InteractiveModeDelegateHost): void {
	host.markdownThemeCache = undefined;
	host.markdownThemeCacheIndent = undefined;
}

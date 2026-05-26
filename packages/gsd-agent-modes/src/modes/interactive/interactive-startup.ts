// Project/App: gsd-pi
// File Purpose: Extracted from interactive-mode.ts (Phase E2 seam remediation).
// @ts-nocheck

import { spawn } from "child_process";
import { VERSION } from "@gsd/pi-coding-agent/config.js";
import { getChangelogPath, getNewEntries, parseChangelog } from "@gsd/pi-coding-agent/utils/changelog.js";
import type { InteractiveModeDelegateHost } from "./interactive-mode-delegate-host.js";

export function getChangelogForDisplay(host: InteractiveModeDelegateHost): string | undefined {
	if (host.session.state.messages.length > 0) {
		return undefined;
	}

	const lastVersion = host.settingsManager.getLastChangelogVersion();
	const changelogPath = getChangelogPath();
	const entries = parseChangelog(changelogPath);

	if (!lastVersion) {
		host.settingsManager.setLastChangelogVersion(VERSION);
		return undefined;
	}

	const newEntries = getNewEntries(entries, lastVersion);
	if (newEntries.length > 0) {
		host.settingsManager.setLastChangelogVersion(VERSION);
		return newEntries.map((e) => e.content).join("\n\n");
	}

	return undefined;
}

export async function checkForNewVersion(host: InteractiveModeDelegateHost): Promise<string | undefined> {
	if (process.env.PI_SKIP_VERSION_CHECK || process.env.PI_OFFLINE) return undefined;

	try {
		const response = await fetch("https://registry.npmjs.org/@gsd/pi-coding-agent/latest", {
			signal: AbortSignal.timeout(10000),
		});
		if (!response.ok) return undefined;

		const data = (await response.json()) as { version?: string };
		const latestVersion = data.version;

		if (latestVersion && latestVersion !== host.version) {
			return latestVersion;
		}

		return undefined;
	} catch {
		return undefined;
	}
}

export async function checkTmuxKeyboardSetup(): Promise<string | undefined> {
	if (!process.env.TMUX) return undefined;

	const runTmuxShow = (option: string): Promise<string | undefined> => {
		return new Promise((resolve) => {
			const proc = spawn("tmux", ["show", "-gv", option], {
				stdio: ["ignore", "pipe", "ignore"],
			});
			let stdout = "";
			const timer = setTimeout(() => {
				proc.kill();
				resolve(undefined);
			}, 2000);

			proc.stdout?.on("data", (data) => {
				stdout += data.toString();
			});
			proc.on("error", () => {
				clearTimeout(timer);
				resolve(undefined);
			});
			proc.on("close", (code) => {
				clearTimeout(timer);
				resolve(code === 0 ? stdout.trim() : undefined);
			});
		});
	};

	const [extendedKeys, extendedKeysFormat] = await Promise.all([
		runTmuxShow("extended-keys"),
		runTmuxShow("extended-keys-format"),
	]);

	if (extendedKeys !== "on" && extendedKeys !== "always") {
		return "tmux extended-keys is off. Modified Enter keys may not work. Add `set -g extended-keys on` to ~/.tmux.conf and restart tmux.";
	}

	if (extendedKeysFormat === "xterm") {
		return "tmux extended-keys-format is xterm. Pi works best with csi-u. Add `set -g extended-keys-format csi-u` to ~/.tmux.conf and restart tmux.";
	}

	return undefined;
}

import { Container, Spacer, Text } from "@gsd/pi-tui";
import type { KeybindingsManager } from "@gsd/agent-core";
import { DynamicBorder } from "./components/dynamic-border.js";
import { appKeyHint } from "./components/keybinding-hints.js";
import { isToolContentBlock } from "./gsd-content-blocks.js";
import { theme } from "@gsd/pi-coding-agent/theme/theme.js";

export type AssistantReplaySegment =
	| { kind: "assistant"; startIndex: number; endIndex: number }
	| { kind: "tool"; contentIndex: number };

function isVisibleAssistantReplayText(block: any): boolean {
	return (
		(block?.type === "text" && typeof block.text === "string" && block.text.trim().length > 0)
		|| (block?.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim().length > 0)
	);
}

/**
 * Build replay segments for historical assistant messages so rebuild paths
 * preserve the original content[] ordering between assistant prose and tools.
 */
export function buildAssistantReplaySegments(contentBlocks: Array<any>): AssistantReplaySegment[] {
	const segments: AssistantReplaySegment[] = [];
	let runStart = -1;
	let runEnd = -1;

	const closeRun = () => {
		if (runStart !== -1) {
			segments.push({ kind: "assistant", startIndex: runStart, endIndex: runEnd });
			runStart = -1;
			runEnd = -1;
		}
	};

	for (let i = 0; i < contentBlocks.length; i++) {
		const block = contentBlocks[i];
		const isAssistantText = isVisibleAssistantReplayText(block);
		const isInvisibleAssistantText = block?.type === "text" || block?.type === "thinking";
		const isTool = isToolContentBlock(block);

		if (isAssistantText) {
			if (runStart === -1) runStart = i;
			runEnd = i;
			continue;
		}

		if (isInvisibleAssistantText) continue;

		closeRun();

		if (isTool) {
			segments.push({ kind: "tool", contentIndex: i });
		}
	}

	closeRun();

	return segments;
}

export function getToolExpansionStartupHint(toolOutputExpanded: boolean, keybindings: KeybindingsManager): string {
	return appKeyHint(keybindings, "expandTools", toolOutputExpanded ? "to collapse tools" : "to expand tools");
}

export type CompactionQueuedMessage = {
	text: string;
	mode: "steer" | "followUp";
};

export type ExtensionNotifyType = "info" | "warning" | "error" | "success" | undefined;

export function shouldRenderExtensionNotifyInChat(type: ExtensionNotifyType): boolean {
	return type !== "warning";
}

function hasAnsiStyling(message: string): boolean {
	return /\x1b\[[0-9;]*m/.test(message);
}

function stripAnsiStyling(message: string): string {
	return message.replace(/\x1b\[[0-9;]*m/g, "");
}

function styleGsdStatusCardMessage(message: string): string | null {
	const plain = stripAnsiStyling(message);
	if (!/(Verification Gate|Commit|Snapshot|GSD .*Complete|Next step)/.test(plain)) return null;

	const styled = plain.split("\n").map((line) => {
		if (line.includes("╭─ ✓") || line.includes("✓ Verification Gate") || line.includes("✓ Commit") || line.includes("✓ Snapshot")) {
			return line.replace(/(╭─)\s+(.*)/, (_match, border, title) =>
				`${theme.fg("borderAccent", border)} ${theme.fg("success", theme.bold(title))}`);
		}
		if (line.includes("╭─ ✕") || line.includes("✕ Verification Gate")) {
			return line.replace(/(╭─)\s+(.*)/, (_match, border, title) =>
				`${theme.fg("borderAccent", border)} ${theme.fg("error", theme.bold(title))}`);
		}
		if (line.includes("╭─ Next step")) {
			return line.replace(/(╭─)\s+(.*)/, (_match, border, title) =>
				`${theme.fg("borderAccent", border)} ${theme.fg("accent", theme.bold(title))}`);
		}
		if (/^\s*╰/.test(line)) {
			return theme.fg("borderAccent", line);
		}
		const contentMatch = /^(\s*)(.*)$/u.exec(line);
		const indent = contentMatch?.[1] ?? "";
		const text = contentMatch?.[2] ?? line;
		if (/(Completed:|Next:|Continue:|Auto-run:)/.test(text)) {
			const styled = text
				.replace(/(Completed:|Next:|Continue:|Auto-run:)/g, (label) => theme.fg("dim", label))
				.replace(/(\/gsd\s+(?:next|auto|status))/g, (command) => theme.fg("success", command));
			return `${indent}${styled}`;
		}
		return text ? `${indent}${theme.fg("text", text)}` : line;
	});
	return styled.join("\n");
}

export interface ExtensionNotifyRenderResult {
	rendered: boolean;
	statusSpacer?: Spacer;
	statusText?: Text;
}

export function renderExtensionNotifyInChat(
	chatContainer: Container,
	message: string,
	type?: ExtensionNotifyType,
): ExtensionNotifyRenderResult {
	if (!shouldRenderExtensionNotifyInChat(type)) {
		return { rendered: false };
	}

	const spacer = new Spacer(1);
	chatContainer.addChild(spacer);

	if (type === "error") {
		chatContainer.addChild(new Text(theme.fg("error", `Error: ${message}`), 1, 0));
		return { rendered: true };
	}
	if (type === "success") {
		chatContainer.addChild(new DynamicBorder((text) => theme.fg("success", text)));
		chatContainer.addChild(new Text(theme.fg("success", message), 1, 0));
		chatContainer.addChild(new DynamicBorder((text) => theme.fg("success", text)));
		chatContainer.addChild(new Spacer(1));
		return { rendered: true };
	}

	const styledStatusCard = styleGsdStatusCardMessage(message);
	const statusText = new Text(
		styledStatusCard ?? (hasAnsiStyling(message) ? message : theme.fg("dim", message)),
		1,
		0,
	);
	chatContainer.addChild(statusText);
	return { rendered: true, statusSpacer: spacer, statusText };
}

export function renderBlockingErrorBanner(container: Container, message: string | undefined): void {
	container.clear();
	if (message === undefined) return;

	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("error", `Error: ${message}`), 1, 0));
}

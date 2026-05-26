// PROTOTYPE — throwaway density experiments for chat/tool transcript layout.
// Question: how much vertical space can we remove without hurting scanability?
// Run: npm run prototype:tui-density [-- current|compact|tight-tools|minimal|all]

import { alignRight, padRight, style, truncateToWidth, visibleWidth } from "@gsd/pi-tui";
import { theme, type ThemeColor } from "../../theme/theme.js";
import type { StatusTone } from "../transcript-design.js";

const USER_LABEL = "YOU";

function headerLabel(text: string): string {
	return text.toUpperCase();
}

function styledHeader(text: string, color: ThemeColor = "borderAccent"): string {
	return theme.fg(color, theme.bold(headerLabel(text)));
}

export type DensityVariantId = "current" | "compact" | "tight-tools" | "minimal";

export interface DensityVariant {
	id: DensityVariantId;
	label: string;
	tagline: string;
	opts: DensityOptions;
}

export interface DensityOptions {
	railPaddingX: number;
	railPaddingY: number;
	openPaddingY: number;
	gapBeforeBlock: number;
	bottomRule: boolean;
	footerMode: "row" | "inline-title" | "none";
	stackCollapsedTools: boolean;
}

export const DENSITY_VARIANTS: DensityVariant[] = [
	{
		id: "current",
		label: "A · Current",
		tagline: "Baseline — paddingY=1, blank gap before blocks, footer row when expanded",
		opts: {
			railPaddingX: 3,
			railPaddingY: 1,
			openPaddingY: 0,
			gapBeforeBlock: 1,
			bottomRule: true,
			footerMode: "row",
			stackCollapsedTools: false,
		},
	},
	{
		id: "compact",
		label: "B · Compact",
		tagline: "Zero vertical padding, no inter-block gaps, hints on title bar",
		opts: {
			railPaddingX: 2,
			railPaddingY: 0,
			openPaddingY: 0,
			gapBeforeBlock: 0,
			bottomRule: false,
			footerMode: "inline-title",
			stackCollapsedTools: false,
		},
	},
	{
		id: "tight-tools",
		label: "C · Tight tools",
		tagline: "Comfortable assistant bubble, collapsed tools stack flush",
		opts: {
			railPaddingX: 3,
			railPaddingY: 1,
			openPaddingY: 0,
			gapBeforeBlock: 0,
			bottomRule: true,
			footerMode: "none",
			stackCollapsedTools: true,
		},
	},
	{
		id: "minimal",
		label: "D · Minimal",
		tagline: "Title rules only — no bottom rules, no footers, no gaps",
		opts: {
			railPaddingX: 2,
			railPaddingY: 0,
			openPaddingY: 0,
			gapBeforeBlock: 0,
			bottomRule: false,
			footerMode: "none",
			stackCollapsedTools: true,
		},
	},
];

function toneColor(tone: StatusTone): ThemeColor {
	switch (tone) {
		case "running":
			return "toolRunning";
		case "success":
			return "border";
		case "error":
			return "toolError";
		case "warning":
			return "warning";
		case "muted":
		default:
			return "toolMuted";
	}
}

function trimOuterBlankLines(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && lines[start].trim().length === 0) start++;
	while (end > start && lines[end - 1].trim().length === 0) end--;
	return lines.slice(start, end);
}

function copyCleanRoundedSurface(
	lines: string[],
	width: number,
	opts: {
		title: string;
		right?: string;
		borderColor: ThemeColor;
		bodyColor: ThemeColor;
		paddingX: number;
		paddingY: number;
	},
): string[] {
	const outerWidth = Math.max(20, width);
	const paddingX = Math.max(0, opts.paddingX);
	const paddingY = Math.max(0, opts.paddingY);
	const title = opts.title;
	const right = opts.right ?? "";
	const border = (text: string) => theme.fg(opts.borderColor, text);
	const contentWidth = Math.max(1, outerWidth - paddingX);

	const titleBudget = right ? Math.max(0, outerWidth - visibleWidth(right) - 9) : Math.max(0, outerWidth - 6);
	const clippedTitle = truncateToWidth(title, titleBudget, "");
	const clippedRight = right ? truncateToWidth(right, Math.max(0, outerWidth - visibleWidth(clippedTitle) - 9), "") : "";
	const fixedWidth = 3 + visibleWidth(clippedTitle) + (clippedRight ? 3 + visibleWidth(clippedRight) : 0) + 1;
	const fill = Math.max(1, outerWidth - fixedWidth);
	const top = clippedRight
		? border("╭─ ") + clippedTitle + border(` ${"─".repeat(fill)} `) + theme.fg("dim", clippedRight) + border("╮")
		: border("╭─ ") + clippedTitle + border(` ${"─".repeat(fill)}╮`);
	const bottom = border("╰" + "─".repeat(Math.max(1, outerWidth - 2)) + "╯");

	const source = trimOuterBlankLines(lines);
	const bodySource = source.length > 0 ? source : [""];
	const blank = "";
	const body = [
		...Array.from({ length: paddingY }, () => blank),
		...bodySource.map(
			(line) => " ".repeat(paddingX) + truncateToWidth(theme.fg(opts.bodyColor, line.trimEnd()), contentWidth, ""),
		),
		...Array.from({ length: paddingY }, () => blank),
	];

	return [top, ...body, bottom].map((line) => padRight(truncateToWidth(line, outerWidth, ""), outerWidth));
}

function renderAssistantRail(
	lines: string[],
	width: number,
	opts: DensityOptions,
	meta = "gpt-test · 1.2s",
): string[] {
	const surface = copyCleanRoundedSurface(lines.length > 0 ? lines : [""], Math.max(20, width), {
		title: styledHeader("GSD", "borderAccent"),
		right: meta,
		borderColor: "borderAccent",
		bodyColor: "assistantMessageText",
		paddingX: opts.railPaddingX,
		paddingY: opts.railPaddingY,
	});
	return surface.map((line) => theme.bg("customMessageBg", line));
}

function renderUserRail(lines: string[], width: number, opts: DensityOptions): string[] {
	const surface = copyCleanRoundedSurface(lines.length > 0 ? lines : [""], Math.max(20, width), {
		title: styledHeader(USER_LABEL, "border"),
		borderColor: "border",
		bodyColor: "userMessageText",
		paddingX: opts.railPaddingX,
		paddingY: opts.railPaddingY,
	});
	return surface.map((line) => theme.bg("userMessageBg", line));
}

function openRuleLine(title: string, right: string, width: number, tone: ThemeColor, bottomRule: boolean): string[] {
	let surface = style()
		.border("open")
		.borderColor((text) => theme.fg(tone, text))
		.title(title);
	if (right) surface = surface.titleRight(right);
	if (!bottomRule) surface = surface.bottomRule(false);
	// Collapsed cards use only the titled top rule — same as transcript-design.ts.
	return [surface.render([], Math.max(20, width))[0]!];
}

function renderOpenCard(
	bodyLines: string[],
	width: number,
	opts: {
		title: string;
		right?: string;
		tone: StatusTone;
		footerLeft?: string;
		footerRight?: string;
	},
	density: DensityOptions,
): string[] {
	const outerWidth = Math.max(20, width);
	const tone = toneColor(opts.tone);
	const body = [...bodyLines];

	let right = opts.right ?? "";
	if (density.footerMode === "inline-title" && (opts.footerLeft || opts.footerRight)) {
		const hint = [opts.footerLeft, opts.footerRight].filter(Boolean).join(" · ");
		right = right ? `${right} · ${theme.fg("dim", hint)}` : theme.fg("dim", hint);
	} else if (density.footerMode === "row" && (opts.footerLeft || opts.footerRight)) {
		body.push("");
		body.push(alignRight(theme.fg("dim", opts.footerLeft ?? ""), theme.fg("dim", opts.footerRight ?? ""), outerWidth));
	}

	let surface = style()
		.border("open")
		.borderColor((text) => theme.fg(tone, text))
		.title(styledHeader(opts.title, "borderAccent"));
	if (right) surface = surface.titleRight(theme.fg(tone, right));
	if (density.openPaddingY > 0) surface = surface.paddingY(density.openPaddingY);
	if (!density.bottomRule) surface = surface.bottomRule(false);
	return surface.render(body, outerWidth);
}

function renderCollapsedTool(
	title: string,
	target: string,
	status: string,
	width: number,
	tone: StatusTone,
	density: DensityOptions,
): string[] {
	const tc = toneColor(tone);
	const titleText = `${styledHeader(title, "borderAccent")} ${theme.fg("text", target)}`;
	const right = theme.fg(tone === "success" ? "success" : tc, `${status} · output hidden · ctrl+o expand`);
	return openRuleLine(titleText, right, width, tc, density.bottomRule);
}

function renderExpandedTool(
	title: string,
	command: string,
	result: string,
	status: string,
	width: number,
	tone: StatusTone,
	density: DensityOptions,
): string[] {
	return renderOpenCard(
		[theme.fg("dim", command), `${theme.fg("success", "✓")} ${result}`],
		width,
		{
			title,
			right: status,
			tone,
			footerLeft: density.footerMode === "row" ? "output expanded" : undefined,
			footerRight: density.footerMode === "row" ? "ctrl+o collapse" : undefined,
		},
		density,
	);
}

function gapLines(count: number): string[] {
	return count > 0 ? Array.from({ length: count }, () => "") : [];
}

function blockWithGap(lines: string[], gapBefore: number): string[] {
	return [...gapLines(gapBefore), ...lines];
}

/** Representative slice of a real session — mirrors the screenshot flow. */
export function renderSampleTranscript(width: number, variant: DensityVariant): string[] {
	const { opts } = variant;
	const out: string[] = [];

	out.push(...renderUserRail(["tighten up the tool cards in the transcript"], width, opts));
	out.push(...gapLines(opts.gapBeforeBlock));
	out.push(
		...renderAssistantRail(
			["I'll kill the background servers and checkpoint the database before saving the assessment summary."],
			width,
			opts,
		),
	);

	const collapsedTools = [
		{ title: "Background Shell", target: "bg_shell kill [87ad363a]", status: "success · 340ms" },
		{ title: "Background Shell", target: "bg_shell kill [87ad363a]", status: "success · 340ms" },
		{ title: "Background Shell", target: "bg_shell kill [87ad363a]", status: "success · 340ms" },
	];

	for (let i = 0; i < collapsedTools.length; i++) {
		const tool = collapsedTools[i]!;
		const gap = opts.stackCollapsedTools && i > 0 ? 0 : opts.gapBeforeBlock;
		out.push(
			...blockWithGap(
				renderCollapsedTool(tool.title, tool.target, tool.status, width, "success", opts),
				gap,
			),
		);
	}

	out.push(
		...blockWithGap(
			renderExpandedTool(
				"Background Shell",
				"bg_shell kill [87ad363a]",
				"Killed 87ad363a python3 -m http.server 3005",
				"success · 340ms",
				width,
				"success",
				opts,
			),
			opts.gapBeforeBlock,
		),
	);
	out.push(
		...blockWithGap(
			renderCollapsedTool("Save Summary", "summary_save ASSESSMENT M002/S02", "success · 120ms", width, "success", opts),
			opts.gapBeforeBlock,
		),
	);
	out.push(
		...blockWithGap(
			renderOpenCard(
				[
					"WAL checkpoint complete — database is safe to stage with git.",
					theme.fg("dim", "Checkpoint at .planning/state/gsd.sqlite-wal"),
				],
				width,
				{ title: "Checkpoint GSD Database", right: "success · 89ms", tone: "success" },
				opts,
			),
			opts.gapBeforeBlock,
		),
	);

	return out;
}

export function renderVariantBanner(variant: DensityVariant, width: number): string[] {
	const label = `${variant.label} — ${variant.tagline}`;
	const rule = theme.fg("borderAccent", "═".repeat(Math.max(20, width)));
	return ["", rule, truncateToWidth(theme.fg("text", label), width, ""), rule, ""];
}

export function getVariant(id: string): DensityVariant {
	const found = DENSITY_VARIANTS.find((v) => v.id === id);
	if (!found) {
		throw new Error(`Unknown variant "${id}". Choose: ${DENSITY_VARIANTS.map((v) => v.id).join(", ")}`);
	}
	return found;
}

export function countVisualLines(lines: string[]): number {
	return lines.filter((line) => stripTrailingSpaces(line).length > 0).length;
}

function stripTrailingSpaces(line: string): string {
	return line.replace(/\s+$/, "");
}

export function lineStats(lines: string[]): { total: number; nonBlank: number; blank: number } {
	const total = lines.length;
	const nonBlank = countVisualLines(lines);
	return { total, nonBlank, blank: total - nonBlank };
}

// PROTOTYPE — throwaway design explorations for chat/tool transcript layout.
// Run: npm run prototype:tui-design [-- all|<id>]

import { alignRight, padRight, style, truncateToWidth, visibleWidth } from "@gsd/pi-tui";
import { theme, type ThemeColor } from "../../theme/theme.js";
import type { StatusTone } from "../transcript-design.js";
import { buildTreePrefix } from "../tree-render-utils.js";
import {
	DENSITY_VARIANTS,
	type DensityVariant,
	getVariant as getDensityVariant,
	lineStats,
	renderSampleTranscript as renderDensitySample,
} from "./transcript-density-prototype.js";

export { lineStats };

export interface DesignPrototype {
	id: string;
	label: string;
	tagline: string;
	inspiration: string;
	render: (width: number) => string[];
}

// ── Shared sample data (mirrors real session flow) ──────────────────────────

const USER_TEXT = "tighten up the tool cards in the transcript";
const USER_LABEL = "YOU";

function headerLabel(text: string): string {
	return text.toUpperCase();
}

function styledHeader(text: string, color: ThemeColor = "borderAccent"): string {
	return theme.fg(color, theme.bold(headerLabel(text)));
}
const ASSISTANT_TEXT =
	"I'll kill the background servers and checkpoint the database before saving the assessment summary.";
const COLLAPSED_TOOLS = [
	{ title: "Background Shell", target: "bg_shell kill [87ad363a]", status: "success · 340ms" },
	{ title: "Background Shell", target: "bg_shell kill [87ad363a]", status: "success · 340ms" },
	{ title: "Background Shell", target: "bg_shell kill [87ad363a]", status: "success · 340ms" },
] as const;

type WorkItem =
	| { kind: "rule"; title: string; target?: string; status: string; tone?: StatusTone }
	| { kind: "expanded"; title: string; command: string; result: string; status: string; tone?: StatusTone }
	| { kind: "body"; title: string; lines: string[]; status: string; tone?: StatusTone };

/** Post-assistant work sequence — used for connector prototypes. */
const SHELL_WORK: WorkItem[] = [
	...COLLAPSED_TOOLS.map(
		(t): WorkItem => ({
			kind: "rule",
			title: t.title,
			target: t.target,
			status: t.status,
			tone: "success",
		}),
	),
	{
		kind: "expanded",
		title: "Background Shell",
		command: "bg_shell kill [87ad363a]",
		result: "Killed 87ad363a python3 -m http.server 3005",
		status: "success · 340ms",
		tone: "success",
	},
];

const FINALIZE_WORK: WorkItem[] = [
	{
		kind: "rule",
		title: "Save Summary",
		target: "summary_save ASSESSMENT M002/S02",
		status: "success · 120ms",
		tone: "success",
	},
	{
		kind: "body",
		title: "Checkpoint GSD Database",
		lines: [
			"WAL checkpoint complete — database is safe to stage with git.",
			"Checkpoint at .planning/state/gsd.sqlite-wal",
		],
		status: "success · 89ms",
		tone: "success",
	},
];

/** Visual hierarchy for flow/connectors (body lines use spaces only — copy-clean). */
const FLOW_INDENT: { phase: number; work: number; body: number; bridge: number } = {
	phase: 2,
	work: 4,
	body: 7,
	bridge: 6,
};

function indentSpaces(cols: number): string {
	return cols > 0 ? " ".repeat(cols) : "";
}

function indentLine(content: string, cols: number, width: number): string {
	if (cols <= 0) return padLine(content, width);
	const budget = Math.max(1, width - cols);
	return padLine(indentSpaces(cols) + truncateToWidth(content, budget, ""), width);
}

// ── Low-level helpers ───────────────────────────────────────────────────────

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

function padLine(line: string, width: number): string {
	return padRight(truncateToWidth(line, width, ""), width);
}

function openRule(title: string, right: string, width: number, tone: ThemeColor, bottomRule = false): string[] {
	let surface = style()
		.border("open")
		.borderColor((text) => theme.fg(tone, text))
		.title(title);
	if (right) surface = surface.titleRight(right);
	if (!bottomRule) surface = surface.bottomRule(false);
	return surface.render([], Math.max(20, width));
}

function openBlock(
	body: string[],
	width: number,
	opts: { title: string; titleColor?: ThemeColor; titlePrefix?: string; right?: string; tone: StatusTone },
	bottomRule = false,
): string[] {
	const tc = toneColor(opts.tone);
	const titleText = (opts.titlePrefix ?? "") + styledHeader(opts.title, opts.titleColor ?? "borderAccent");
	let surface = style()
		.border("open")
		.borderColor((text) => theme.fg(tc, text))
		.title(titleText);
	if (opts.right) surface = surface.titleRight(theme.fg(tc, opts.right));
	if (!bottomRule) surface = surface.bottomRule(false);
	return surface.render(body, Math.max(20, width));
}

function statusDot(tone: StatusTone): string {
	const color = tone === "success" ? "success" : tone === "error" ? "error" : tone === "running" ? "toolRunning" : "dim";
	return theme.fg(color, "●");
}

function chip(label: string, color: ThemeColor = "borderAccent"): string {
	return theme.fg(color, theme.bold(` ${headerLabel(label)} `));
}

function dimRule(width: number, fraction = 0.35): string[] {
	const w = Math.max(12, Math.floor(width * fraction));
	return [padLine(theme.fg("dim", "─".repeat(w)), width)];
}

/** Connectors on rule/spine rows only — body lines use space indent (copy-clean). */
function spineGapLine(width: number, indentCols: number = FLOW_INDENT.work): string {
	return indentLine(theme.fg("dim", "│"), indentCols, width);
}

function branchPrefix(isLast: boolean, indentCols: number = FLOW_INDENT.work): string {
	return theme.fg("dim", indentSpaces(indentCols) + (isLast ? "└─ " : "├─ "));
}

function prefixRuleLine(prefix: string, ruleLine: string, width: number): string {
	const budget = Math.max(20, width - visibleWidth(prefix));
	return padLine(prefix + truncateToWidth(ruleLine, budget, ""), width);
}

function renderIndentedWorkBlock(
	rendered: string[],
	width: number,
	opts: { branchPrefix: string; bodyIndent: number },
): string[] {
	if (rendered.length === 0) return [];
	const out = [prefixRuleLine(opts.branchPrefix, rendered[0]!, width)];
	for (let j = 1; j < rendered.length; j++) {
		out.push(indentLine(rendered[j]!, opts.bodyIndent, width));
	}
	return out;
}

function indentOpenBodyLines(lines: string[], width: number, bodyIndent = FLOW_INDENT.body): string[] {
	if (lines.length <= 1) return lines;
	return [lines[0]!, ...lines.slice(1).map((line) => indentLine(line.trimEnd(), bodyIndent, width))];
}

function renderCollapsedRuleLine(
	title: string,
	target: string | undefined,
	status: string,
	width: number,
	tone: StatusTone,
	innerWidth?: number,
): string {
	const w = innerWidth ?? width;
	const tc = toneColor(tone);
	const titleText = `${theme.fg("borderAccent", headerLabel(title))}${target ? ` ${theme.fg("text", target)}` : ""}`;
	const right = theme.fg(tone === "success" ? "success" : tc, status);
	return openRule(titleText, right, w, tc, false)[0]!;
}

function renderWorkItem(item: WorkItem, width: number, innerWidth?: number): string[] {
	const w = innerWidth ?? width;
	const tone = item.tone ?? "success";
	switch (item.kind) {
		case "rule":
			return [renderCollapsedRuleLine(item.title, item.target, item.status, width, tone, w)];
		case "expanded":
			return openBlock(
				[theme.fg("dim", item.command), `${theme.fg("success", "✓")} ${item.result}`],
				w,
				{ title: item.title, right: item.status, tone },
				false,
			);
		case "body":
			return openBlock(
				item.lines.map((line, i) => (i === item.lines.length - 1 ? theme.fg("dim", line) : line)),
				w,
				{ title: item.title, right: item.status, tone },
				false,
			);
	}
}

function renderUserTurn(width: number): string[] {
	return openBlock([USER_TEXT], width, { title: USER_LABEL, titleColor: "border", tone: "muted" }, false);
}

function workflowBridgeLine(label: string, width: number): string {
	const lead = theme.fg("borderAccent", "      ╰─ ") + styledHeader(label, "borderAccent");
	const fill = Math.max(4, width - visibleWidth(lead) - 2);
	return padLine(lead + theme.fg("dim", " " + "─".repeat(fill)), width);
}

function renderAssistantTurn(width: number, bridgeLabel?: string): string[] {
	const out = openBlock([ASSISTANT_TEXT], width, {
		title: "GSD",
		titleColor: "borderAccent",
		right: theme.fg("dim", "gpt-test · 1.2s"),
		tone: "success",
	}, false);
	if (bridgeLabel) {
		out.push(workflowBridgeLine(bridgeLabel, width));
	}
	return out;
}

/** Vertical spine + tree branch prefixes on rule rows; body lines indented under branch. */
function renderConnectedWork(
	items: WorkItem[],
	width: number,
	opts: { workIndent?: number; bodyIndent?: number } = {},
): string[] {
	const workIndent = opts.workIndent ?? FLOW_INDENT.work;
	const bodyIndent = opts.bodyIndent ?? FLOW_INDENT.body;
	const innerWidth = Math.max(20, width - workIndent - 3);
	const out: string[] = [];

	for (let i = 0; i < items.length; i++) {
		const isLast = i === items.length - 1;
		const rendered = renderWorkItem(items[i]!, width, innerWidth);
		out.push(
			...renderIndentedWorkBlock(rendered, width, {
				branchPrefix: theme.fg("dim", indentSpaces(workIndent) + buildTreePrefix([], isLast, 1)),
				bodyIndent,
			}),
		);
	}
	return out;
}

/** Continuous │ spine between rule rows; nested body content indented. */
function renderSpineLinkedWork(
	items: WorkItem[],
	width: number,
	opts: { workIndent?: number; bodyIndent?: number } = {},
): string[] {
	const workIndent = opts.workIndent ?? FLOW_INDENT.work;
	const bodyIndent = opts.bodyIndent ?? FLOW_INDENT.body;
	const innerWidth = Math.max(20, width - workIndent - 3);
	const out: string[] = [];

	for (let i = 0; i < items.length; i++) {
		const isLast = i === items.length - 1;
		if (i > 0) {
			out.push(spineGapLine(width, workIndent));
		}
		const rendered = renderWorkItem(items[i]!, width, innerWidth);
		out.push(
			...renderIndentedWorkBlock(rendered, width, {
				branchPrefix: branchPrefix(isLast, workIndent),
				bodyIndent,
			}),
		);
	}
	return out;
}

function renderPhaseHeader(label: string, meta: string, width: number, indentCols: number = FLOW_INDENT.phase): string[] {
	const innerWidth = Math.max(20, width - indentCols);
	const title = styledHeader(label, "borderAccent");
	const right = theme.fg("dim", meta);
	const rule = openRule(title, right, innerWidth, "borderAccent", false)[0]!;
	return [indentLine(rule, indentCols, width)];
}

// ── Rethink: unified design system ───────────────────────────────────────────

interface WorkGroup {
	label: string;
	meta: string;
	items: WorkItem[];
	/** Use ╰─ bridge from assistant instead of phase header rule */
	bridged?: boolean;
}

function renderCompactTurn(
	role: "You" | "GSD",
	body: string,
	width: number,
	opts: { meta?: string; tone?: StatusTone; titleColor?: ThemeColor } = {},
): string[] {
	const titleColor = opts.titleColor ?? (role === "You" ? "border" : "borderAccent");
	const displayRole = role === "You" ? USER_LABEL : headerLabel(role);
	return openBlock([body], width, {
		title: displayRole,
		titleColor,
		right: opts.meta ? theme.fg("dim", opts.meta) : undefined,
		tone: opts.tone ?? (role === "You" ? "muted" : "success"),
	}, false);
}

function renderWorkGroup(group: WorkGroup, width: number): string[] {
	const bridged = group.bridged ?? false;
	const workIndent = bridged ? FLOW_INDENT.bridge : FLOW_INDENT.work;
	const bodyIndent = workIndent + 3;
	const out: string[] = [];

	if (bridged) {
		out.push(workflowBridgeLine(group.label, width));
		out.push(spineGapLine(width, workIndent));
	} else {
		out.push(...renderPhaseHeader(group.label, group.meta, width));
		out.push(spineGapLine(width, workIndent));
	}
	out.push(...renderSpineLinkedWork(group.items, width, { workIndent, bodyIndent }));
	return out;
}

/** ★ Recommended — open turns, bridged work groups, spine-linked actions. */
function renderGsdFlow(width: number): string[] {
	return [
		...renderCompactTurn("You", USER_TEXT, width),
		...renderCompactTurn("GSD", ASSISTANT_TEXT, width, { meta: "gpt-test · 1.2s" }),
		...renderWorkGroup({
			label: "shell cleanup",
			meta: "4 actions · 1.4s",
			items: SHELL_WORK.map((item) =>
				item.kind === "expanded"
					? { ...item, status: `${item.status} · ctrl+o collapse` }
					: { ...item, status: `${item.status} · ctrl+o expand` },
			),
			bridged: true,
		}, width),
		"",
		...renderWorkGroup({ label: "finalize", meta: "2 actions · 209ms", items: FINALIZE_WORK, bridged: true }, width),
	];
}

/** Document mode — Glamour-style sections, no tree connectors. */
function renderGsdDocument(width: number): string[] {
	const section = (title: string, meta: string, lines: string[], titleColor: ThemeColor = "mdHeading") => {
		const headIndent = 0;
		const bodyIndent = 2;
		const listIndent = 4;
		const out = [
			indentLine(styledHeader(title, titleColor), headIndent, width),
			indentLine(theme.fg("dim", meta), bodyIndent, width),
		];
		for (const line of lines) {
			out.push(indentLine(line, line.startsWith("•") ? listIndent : bodyIndent, width));
		}
		out.push("");
		return out;
	};

	return [
		...section(USER_LABEL, "12:34:01", [USER_TEXT], "border"),
		...section("GSD", "gpt-test · 1.2s", [ASSISTANT_TEXT], "borderAccent"),
		...section(
			"Shell cleanup",
			"4 actions · 1.4s",
			[
				...COLLAPSED_TOOLS.map(
					(t) => `${theme.fg("mdListBullet", "•")} ${t.target}  ${theme.fg("success", t.status)}`,
				),
				theme.fg("dim", "bg_shell kill [87ad363a]"),
				`${theme.fg("success", "✓")} Killed 87ad363a python3 -m http.server 3005`,
			],
			"toolTitle",
		),
		...section(
			"Finalization",
			"2 actions · 209ms",
			[
				`${theme.fg("success", "✓")} ASSESSMENT M002/S02 saved`,
				"WAL checkpoint complete — database is safe to stage with git.",
				theme.fg("dim", "Checkpoint at .planning/state/gsd.sqlite-wal"),
			],
			"customMessageLabel",
		),
	];
}

/** Stream mode — minimal prompts, flat indented work list. */
function renderGsdStream(width: number): string[] {
	const prompt = (mark: string, text: string, color: ThemeColor = "text") =>
		padLine(`${theme.fg("dim", mark)} ${theme.fg(color, text)}`, width);
	const workLine = (label: string, detail: string, status: string) =>
		indentLine(
			`${styledHeader(label, "borderAccent")}  ${theme.fg("dim", detail)}  ${theme.fg("success", status)}`,
			FLOW_INDENT.work,
			width,
		);

	return [
		prompt("›", USER_TEXT, "userMessageText"),
		prompt("◆", ASSISTANT_TEXT, "assistantMessageText"),
		indentLine(theme.fg("dim", headerLabel("shell cleanup")), FLOW_INDENT.work, width),
		...COLLAPSED_TOOLS.map((t) => workLine(t.title, t.target, t.status)),
		workLine("Background Shell", "Killed 87ad363a python3 -m http.server 3005", "340ms"),
		"",
		indentLine(theme.fg("dim", headerLabel("finalize")), FLOW_INDENT.work, width),
		workLine("Save Summary", "ASSESSMENT M002/S02", "120ms"),
		workLine("Checkpoint", "WAL checkpoint complete", "89ms"),
	];
}

/** Connected rail cards — matches GSD step-complete / auto-status-message.ts. */
const CONNECTED_INDENT = 4;

function connectedRuleFill(width: number, indent = CONNECTED_INDENT): string {
	return "─".repeat(Math.max(16, Math.min(40, width - indent - 1)));
}

/** Bridge from an indented user turn down to a left-pegged GSD turn. */
function renderChatTurnBridge(width: number, fromIndent = CONNECTED_INDENT): string[] {
	const bridge = indentSpaces(fromIndent + 2) + "╰──────╮";
	return [padLine(theme.fg("borderAccent", bridge), width)];
}

function renderConnectedCard(
	width: number,
	title: string,
	bodyLines: string[],
	opts: { indent?: number; titleRight?: string; railColor?: ThemeColor; titleColor?: ThemeColor } = {},
): string[] {
	const indent = opts.indent ?? CONNECTED_INDENT;
	const prefix = indentSpaces(indent);
	const railColor = opts.railColor ?? "borderAccent";
	const rail = (text: string) => theme.fg(railColor, text);
	const resolvedTitleColor =
		opts.titleColor ??
		(title.includes("✕") ? "error" : title.includes("✓") ? "success" : railColor);
	const titleStyled = theme.fg(resolvedTitleColor, theme.bold(headerLabel(title)));
	const lead = prefix + rail("╭─ ") + titleStyled;
	let topLine = lead;
	if (opts.titleRight) {
		const fill = Math.max(4, width - visibleWidth(lead) - visibleWidth(opts.titleRight) - 1);
		topLine = lead + rail(" " + "─".repeat(fill) + " ") + opts.titleRight;
	}
	const out = [padLine(topLine, width)];
	for (const line of bodyLines) {
		out.push(padLine(prefix + "   " + line, width));
	}
	out.push(padLine(prefix + rail("╰" + connectedRuleFill(width, indent)), width));
	return out;
}

function renderConnectedDetail(label: string, value: string): string {
	return `${theme.fg("dim", `${headerLabel(label)}:`)} ${theme.fg("accent", value)}`;
}

function renderConnectedToolLine(target: string, status: string): string {
	return `${theme.fg("text", target)}  ${theme.fg("success", status)}`;
}

/** Connected rail applied to full transcript — the step-complete look you liked. */
function renderGsdConnected(width: number): string[] {
	const shellBody = [
		...COLLAPSED_TOOLS.map((t) => renderConnectedToolLine(t.target, t.status)),
		theme.fg("dim", "bg_shell kill [87ad363a]"),
		`${theme.fg("success", "✓")} Killed 87ad363a python3 -m http.server 3005`,
	];

	return [
		...renderConnectedCard(width, USER_LABEL, [USER_TEXT], { railColor: "border", titleColor: "border" }),
		...renderChatTurnBridge(width),
		...renderConnectedCard(width, "GSD", [ASSISTANT_TEXT], {
			indent: 0,
			titleRight: theme.fg("dim", "gpt-test · 1.2s"),
		}),
		"",
		...renderConnectedCard(width, "✓ Shell cleanup", shellBody),
		"",
		...renderConnectedCard(width, "✓ Finalization", [
			renderConnectedDetail("Save Summary", "ASSESSMENT M002/S02 · success · 120ms"),
			renderConnectedDetail("Checkpoint", "WAL checkpoint complete · 89ms"),
		]),
		"",
		...renderConnectedCard(width, "✓ GSD Step Complete", [
			renderConnectedDetail("Completed", "planning M003-mx79kt/S01"),
		]),
	];
}

// ── Design: current (re-export density baseline) ─────────────────────────────

function renderCurrent(width: number): string[] {
	return renderDensitySample(width, getDensityVariant("current"));
}

// ── Design: open-unified (ADR-019 everywhere) ────────────────────────────────

function renderOpenUnified(width: number): string[] {
	const out: string[] = [];
	out.push(
		...openBlock([USER_TEXT], width, { title: USER_LABEL, titleColor: "border", tone: "muted" }, false),
	);
	out.push(
		...openBlock([ASSISTANT_TEXT], width, {
			title: "GSD",
			right: theme.fg("dim", "gpt-test · 1.2s"),
			tone: "success",
		}, false),
	);
	for (const tool of COLLAPSED_TOOLS) {
		const title = `${theme.fg("borderAccent", headerLabel(tool.title))} ${theme.fg("text", tool.target)}`;
		const right = theme.fg("success", `${tool.status} · ctrl+o expand`);
		out.push(...openRule(title, right, width, "border", false).map((line) => indentLine(line, FLOW_INDENT.work, width)));
	}
	out.push(
		...indentOpenBodyLines(
			openBlock(
				[
					theme.fg("dim", "bg_shell kill [87ad363a]"),
					`${theme.fg("success", "✓")} Killed 87ad363a python3 -m http.server 3005`,
				],
				width,
				{
					title: "Background Shell",
					right: theme.fg("success", "success · 340ms · ctrl+o collapse"),
					tone: "success",
				},
				false,
			),
			width,
		),
	);
	out.push(
		...openRule(
			`${theme.fg("borderAccent", headerLabel("Save Summary"))} ${theme.fg("text", "summary_save ASSESSMENT M002/S02")}`,
			theme.fg("success", "success · 120ms"),
			width,
			"border",
			false,
		),
	);
	out.push(
		...indentOpenBodyLines(
			openBlock(
				[
					"WAL checkpoint complete — database is safe to stage with git.",
					theme.fg("dim", "Checkpoint at .planning/state/gsd.sqlite-wal"),
				],
				width,
				{ title: "Checkpoint GSD Database", right: "success · 89ms", tone: "success" },
				false,
			),
			width,
		),
	);
	return out;
}

// ── Design: glamour-flow (document / Glamour stylesheet) ─────────────────────

function renderGlamourFlow(width: number): string[] {
	const contentIndent = 2;
	const listIndent = 4;
	const heading = (text: string, color: ThemeColor = "mdHeading") => padLine(styledHeader(text, color), width);
	const meta = (text: string) => indentLine(theme.fg("dim", text), contentIndent, width);
	const body = (text: string, indent = contentIndent) => indentLine(text, indent, width);

	return [
		heading(USER_LABEL, "border"),
		meta("12:34:01"),
		body(USER_TEXT),
		"",
		heading("GSD", "borderAccent"),
		meta("gpt-test · 1.2s"),
		body(ASSISTANT_TEXT),
		"",
		heading("Background Shell", "toolTitle"),
		meta("3 actions · shell cleanup"),
		...COLLAPSED_TOOLS.map((t) =>
			body(`${theme.fg("mdListBullet", "•")} ${t.target}  ${theme.fg("success", t.status)}`, listIndent),
		),
		"",
		heading("Background Shell", "toolTitle"),
		meta("expanded · success · 340ms"),
		body(theme.fg("dim", "bg_shell kill [87ad363a]"), listIndent),
		body(`${theme.fg("success", "✓")} Killed 87ad363a python3 -m http.server 3005`, listIndent),
		"",
		heading("Save Summary", "toolTitle"),
		body(`${theme.fg("success", "✓")} ASSESSMENT M002/S02 saved`, contentIndent),
		"",
		heading("Checkpoint GSD Database", "customMessageLabel"),
		meta("success · 89ms"),
		body("WAL checkpoint complete — database is safe to stage with git.", contentIndent),
		body(theme.fg("dim", "Checkpoint at .planning/state/gsd.sqlite-wal"), contentIndent),
	];
}

// ── Design: charm-minimal (Lip Gloss semantic badges) ────────────────────────

function renderCharmMinimal(width: number): string[] {
	const out: string[] = [];
	out.push(padLine(`${chip(USER_LABEL, "border")} ${USER_TEXT}`, width));
	out.push(padLine(`${chip("GSD", "borderAccent")} ${ASSISTANT_TEXT}`, width));
	out.push(padLine(theme.fg("dim", `  ${"─".repeat(Math.min(40, width - 4))}`), width));
	for (const tool of COLLAPSED_TOOLS) {
		const title = `${statusDot("success")} ${styledHeader(tool.title, "borderAccent")} ${theme.fg("dim", tool.target)}`;
		out.push(...openRule(title, theme.fg("success", tool.status), width, "border", false));
	}
	out.push(
		...indentOpenBodyLines(
			openBlock(
				[
					theme.fg("dim", "bg_shell kill [87ad363a]"),
					`${theme.fg("success", "✓")} ${theme.fg("text", "Killed 87ad363a python3 -m http.server 3005")}`,
				],
				width,
				{
					title: "Background Shell",
					titlePrefix: `${statusDot("success")} `,
					right: theme.fg("success", "success · 340ms"),
					tone: "success",
				},
				false,
			),
			width,
		),
	);
	out.push(
		...openRule(
			`${statusDot("success")} ${styledHeader("Save Summary", "borderAccent")} ${theme.fg("dim", "M002/S02")}`,
			theme.fg("success", "120ms"),
			width,
			"border",
			false,
		),
	);
	out.push(
		...openBlock(
			["WAL checkpoint complete — database is safe to stage with git."],
			width,
			{
				title: "Checkpoint",
				titlePrefix: `${statusDot("success")} `,
				titleColor: "customMessageLabel",
				right: theme.fg("success", "89ms"),
				tone: "success",
			},
			false,
		),
	);
	return out;
}

// ── Design: timeline (log stream) ────────────────────────────────────────────

function renderTimeline(width: number): string[] {
	const stamp = (t: string) => theme.fg("dim", t);
	const out: string[] = [];
	out.push(
		...openBlock([USER_TEXT], width, {
			title: USER_LABEL,
			titleColor: "border",
			right: stamp("12:34:01"),
			tone: "muted",
		}, false),
	);
	out.push(
		...openBlock([ASSISTANT_TEXT], width, {
			title: "GSD",
			right: stamp("12:34:02 · gpt-test"),
			tone: "success",
		}, false),
	);
	out.push(
		...openBlock(
			[
				...COLLAPSED_TOOLS.map(
					(t, i) =>
						`${stamp(String(12 + i).padStart(2, "0") + ":34:0" + (3 + i))}  ${t.target}  ${theme.fg("success", t.status)}`,
				),
			],
			width,
			{
				title: "Phase · Shell cleanup",
				right: stamp("3 actions · 1.02s"),
				tone: "success",
			},
			false,
		),
	);
	out.push(
		...openBlock(
			[
				theme.fg("dim", "bg_shell kill [87ad363a]"),
				`${theme.fg("success", "✓")} Killed 87ad363a python3 -m http.server 3005`,
			],
			width,
			{
				title: "Background Shell",
				right: stamp("12:34:06 · expanded"),
				tone: "success",
			},
			false,
		),
	);
	out.push(
		...openRule(
			`${theme.fg("borderAccent", headerLabel("Save Summary"))} ${theme.fg("text", "ASSESSMENT M002/S02")}`,
			stamp("12:34:07 · 120ms"),
			width,
			"border",
			false,
		),
	);
	out.push(
		...openBlock(
			["WAL checkpoint complete — database is safe to stage with git."],
			width,
			{ title: "Checkpoint GSD Database", right: stamp("12:34:08 · 89ms"), tone: "success" },
			false,
		),
	);
	return out;
}

// ── Design: phase-rollup (batch repetitive tools) ────────────────────────────

function renderPhaseRollup(width: number): string[] {
	const out: string[] = [];
	out.push(
		...openBlock([USER_TEXT], width, { title: USER_LABEL, titleColor: "border", tone: "muted" }, false),
	);
	out.push(
		...openBlock([ASSISTANT_TEXT], width, {
			title: "GSD",
			right: theme.fg("dim", "gpt-test · 1.2s"),
			tone: "success",
		}, false),
	);
	out.push(
		...openBlock(
			COLLAPSED_TOOLS.map((t) =>
				alignRight(t.target, theme.fg("success", t.status), Math.max(20, width - FLOW_INDENT.body)),
			),
			width,
			{
				title: "Shell cleanup",
				right: theme.fg("success", "3 actions · 1.02s · ctrl+o expand"),
				tone: "success",
			},
			false,
		).map((line, i) => (i === 0 ? line : indentLine(line.trimEnd(), FLOW_INDENT.body, width))),
	);
	out.push(
		...indentOpenBodyLines(
			openBlock(
				[
					theme.fg("dim", "bg_shell kill [87ad363a]"),
					`${theme.fg("success", "✓")} Killed 87ad363a python3 -m http.server 3005`,
				],
				width,
				{
					title: "Background Shell",
					right: theme.fg("success", "success · 340ms"),
					tone: "success",
				},
				false,
			),
			width,
		),
	);
	out.push(
		...openRule(
			`${theme.fg("borderAccent", headerLabel("Save Summary"))} ${theme.fg("text", "ASSESSMENT M002/S02")}`,
			theme.fg("success", "success · 120ms"),
			width,
			"border",
			false,
		).map((line) => indentLine(line, FLOW_INDENT.work, width)),
	);
	out.push(
		...indentOpenBodyLines(
			openBlock(
				[
					"WAL checkpoint complete — database is safe to stage with git.",
					theme.fg("dim", ".planning/state/gsd.sqlite-wal"),
				],
				width,
				{ title: "Checkpoint GSD Database", right: "success · 89ms", tone: "success" },
				false,
			),
			width,
		),
	);
	return out;
}

// ── Design: whisper (ultra-minimal) ──────────────────────────────────────────

function renderWhisper(width: number): string[] {
	const prompt = (p: string, text: string) =>
		padLine(`${theme.fg("dim", p)} ${theme.fg("text", text)}`, width);
	const tool = (label: string, detail: string, status: string) =>
		padLine(`${theme.fg("dim", "  ")}${styledHeader(label, "borderAccent")}  ${theme.fg("muted", detail)}  ${theme.fg("success", status)}`, width);

	return [
		prompt("›", USER_TEXT),
		...dimRule(width, 0.25),
		prompt("◆", ASSISTANT_TEXT),
		...dimRule(width, 0.25),
		padLine(theme.fg("dim", `  ${headerLabel("tools")}`), width),
		...COLLAPSED_TOOLS.map((t) => tool(t.title, t.target, t.status)),
		tool("Background Shell", "Killed 87ad363a python3 -m http.server 3005", "340ms"),
		tool("Save Summary", "ASSESSMENT M002/S02", "120ms"),
		tool("Checkpoint", "WAL checkpoint complete", "89ms"),
	];
}

// ── Design: flow connectors (linked work sets) ───────────────────────────────

function renderFlowTree(width: number): string[] {
	return [
		...renderUserTurn(width),
		...renderAssistantTurn(width),
		...renderConnectedWork(SHELL_WORK, width),
		indentLine(theme.fg("dim", "─".repeat(Math.min(28, width - FLOW_INDENT.work - 4))), FLOW_INDENT.work, width),
		...renderConnectedWork(FINALIZE_WORK, width),
	];
}

function renderFlowSpine(width: number): string[] {
	return [
		...renderUserTurn(width),
		...renderAssistantTurn(width),
		...renderSpineLinkedWork(SHELL_WORK, width),
		"",
		...renderPhaseHeader("Finalization", "2 actions", width),
		spineGapLine(width, FLOW_INDENT.work),
		...renderSpineLinkedWork(FINALIZE_WORK, width),
	];
}

function renderFlowBridge(width: number): string[] {
	const bridged = { workIndent: FLOW_INDENT.bridge, bodyIndent: FLOW_INDENT.bridge + 3 };
	return [
		...renderUserTurn(width),
		...renderAssistantTurn(width, "shell cleanup"),
		spineGapLine(width, FLOW_INDENT.bridge),
		...renderSpineLinkedWork(SHELL_WORK, width, bridged),
		"",
		workflowBridgeLine("finalize", width),
		spineGapLine(width, FLOW_INDENT.bridge),
		...renderSpineLinkedWork(FINALIZE_WORK, width, bridged),
	];
}

function renderFlowPhases(width: number): string[] {
	return [
		...renderUserTurn(width),
		...renderAssistantTurn(width),
		...renderPhaseHeader("Shell cleanup", "4 actions · 1.4s", width),
		spineGapLine(width, FLOW_INDENT.work),
		...renderSpineLinkedWork(SHELL_WORK, width),
		"",
		...renderPhaseHeader("Finalization", "2 actions · 209ms", width),
		spineGapLine(width, FLOW_INDENT.work),
		...renderSpineLinkedWork(FINALIZE_WORK, width),
	];
}

// ── Design: lipgloss-panel (rounded messages, open tools) ───────────────────

function renderLipglossPanel(width: number): string[] {
	const userPanel = style()
		.border("rounded")
		.borderColor((text) => theme.fg("border", text))
		.paddingX(1)
		.paddingY(0)
		.title(styledHeader(USER_LABEL, "border"))
		.render([USER_TEXT], width);

	const assistantPanel = style()
		.border("rounded")
		.borderColor((text) => theme.fg("borderAccent", text))
		.paddingX(1)
		.paddingY(0)
		.title(styledHeader("GSD", "borderAccent"))
		.titleRight(theme.fg("dim", "gpt-test · 1.2s"))
		.render([ASSISTANT_TEXT], width);

	const out = [...userPanel, "", ...assistantPanel, ""];
	for (const tool of COLLAPSED_TOOLS) {
		const title = `${styledHeader(tool.title, "borderAccent")} ${theme.fg("text", tool.target)}`;
		out.push(...openRule(title, theme.fg("success", tool.status), width, "border", false));
	}
	out.push(
		...openBlock(
			[
				theme.fg("dim", "bg_shell kill [87ad363a]"),
				`${theme.fg("success", "✓")} Killed 87ad363a python3 -m http.server 3005`,
			],
			width,
			{ title: "Background Shell", right: "success · 340ms", tone: "success" },
			false,
		),
	);
	out.push(
		...openRule(
			`${styledHeader("Save Summary", "borderAccent")} ${theme.fg("text", "ASSESSMENT M002/S02")}`,
			theme.fg("success", "120ms"),
			width,
			"border",
			false,
		),
	);
	out.push(
		...openBlock(
			["WAL checkpoint complete — database is safe to stage with git."],
			width,
			{ title: "Checkpoint GSD Database", right: "success · 89ms", tone: "success" },
			false,
		),
	);
	return out;
}

// ── Density variants (prior exploration) ─────────────────────────────────────

function wrapDensity(variant: DensityVariant): DesignPrototype {
	return {
		id: variant.id,
		label: variant.label,
		tagline: variant.tagline,
		inspiration: "Density tuning (prior prototype)",
		render: (width) => renderDensitySample(width, variant),
	};
}

// ── Registry ─────────────────────────────────────────────────────────────────

/** Default comparison set — the rethink. */
export const RETHINK_PROTOTYPES: DesignPrototype[] = [
	{
		id: "current",
		label: "0 · Current",
		tagline: "Production today — rounded bubbles, spaced tool cards",
		inspiration: "Baseline (before)",
		render: renderCurrent,
	},
	{
		id: "gsd-flow",
		label: "★ GSD Flow",
		tagline: "Recommended — open turns, bridged work groups, spine tree, tight",
		inspiration: "ADR-019 + flow-phases + flow-bridge synthesis",
		render: renderGsdFlow,
	},
	{
		id: "gsd-document",
		label: "GSD Document",
		tagline: "Glamour-style sections — prose-first, bullet tools, no connectors",
		inspiration: "Charm Glamour / readable long sessions",
		render: renderGsdDocument,
	},
	{
		id: "gsd-stream",
		label: "GSD Stream",
		tagline: "Ultra-compact — prompt chars, flat indented work list",
		inspiration: "Claude Code brevity + maximum density",
		render: renderGsdStream,
	},
	{
		id: "gsd-connected",
		label: "★ GSD Connected",
		tagline: "Connected rail cards — the step-complete look applied to the full flow",
		inspiration: "auto-status-message.ts formatConnectedStepStack",
		render: renderGsdConnected,
	},
];

/** Prior exploration variants — npm run prototype:tui-design -- explore */
export const LEGACY_PROTOTYPES: DesignPrototype[] = [
	{
		id: "open-unified",
		label: "Open unified",
		tagline: "ADR-019 everywhere — horizontal rules only",
		inspiration: "ADR-019",
		render: renderOpenUnified,
	},
	{
		id: "glamour-flow",
		label: "Glamour flow",
		tagline: "Document headings + bullet tools",
		inspiration: "Glamour",
		render: renderGlamourFlow,
	},
	{
		id: "charm-minimal",
		label: "Charm minimal",
		tagline: "Chips, dots, semantic rule colors",
		inspiration: "Lip Gloss",
		render: renderCharmMinimal,
	},
	{
		id: "timeline",
		label: "Timeline",
		tagline: "Timestamp log stream",
		inspiration: "Structured logging",
		render: renderTimeline,
	},
	{
		id: "phase-rollup",
		label: "Phase rollup",
		tagline: "Batch repetitive tools",
		inspiration: "Batch UX",
		render: renderPhaseRollup,
	},
	{
		id: "whisper",
		label: "Whisper",
		tagline: "Prompt chars + half-width separators",
		inspiration: "Minimal shell",
		render: renderWhisper,
	},
	{
		id: "lipgloss-panel",
		label: "Lipgloss panel",
		tagline: "Rounded message panels + open tools",
		inspiration: "Lip Gloss rounded",
		render: renderLipglossPanel,
	},
	{
		id: "flow-tree",
		label: "Flow tree",
		tagline: "Tree branches per action",
		inspiration: "tree-render-utils",
		render: renderFlowTree,
	},
	{
		id: "flow-spine",
		label: "Flow spine",
		tagline: "Vertical spine between rules",
		inspiration: "Timeline spine",
		render: renderFlowSpine,
	},
	{
		id: "flow-bridge",
		label: "Flow bridge",
		tagline: "╰─ bridge from assistant",
		inspiration: "Connected rail",
		render: renderFlowBridge,
	},
	{
		id: "flow-phases",
		label: "Flow phases",
		tagline: "Named phases + spine",
		inspiration: "ToolPhaseSummary",
		render: renderFlowPhases,
	},
	...DENSITY_VARIANTS.filter((v) => !["current"].includes(v.id)).map(wrapDensity),
];

export const DESIGN_PROTOTYPES: DesignPrototype[] = [...RETHINK_PROTOTYPES, ...LEGACY_PROTOTYPES];

export function getDesignPrototype(id: string): DesignPrototype {
	const resolved = id === "rethink" ? "gsd-flow" : id;
	const found = DESIGN_PROTOTYPES.find((p) => p.id === resolved);
	if (!found) {
		throw new Error(
			`Unknown prototype "${id}". Rethink: ${RETHINK_PROTOTYPES.map((p) => p.id).join(", ")} · legacy: npm run prototype:tui-design -- explore`,
		);
	}
	return found;
}

export function resolvePrototypeSet(mode: string): DesignPrototype[] {
	if (mode === "explore") return DESIGN_PROTOTYPES;
	if (mode === "all" || mode === "rethink") return RETHINK_PROTOTYPES;
	return [getDesignPrototype(mode)];
}

export function renderPrototypeBanner(prototype: DesignPrototype, width: number): string[] {
	const label = `${prototype.label} — ${prototype.tagline}`;
	const inspo = theme.fg("dim", `inspired by: ${prototype.inspiration}`);
	const rule = theme.fg("borderAccent", "═".repeat(Math.max(20, width)));
	return ["", rule, truncateToWidth(theme.fg("text", label), width, ""), truncateToWidth(inspo, width, ""), rule, ""];
}

export function listPrototypeIds(): string[] {
	return DESIGN_PROTOTYPES.map((p) => p.id);
}

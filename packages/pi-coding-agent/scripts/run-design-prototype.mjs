#!/usr/bin/env node
// PROTOTYPE runner — transcript design rethink comparison.
// Usage:
//   npm run prototype:tui-design              → rethink set (default)
//   npm run prototype:tui-design -- gsd-flow
//   npm run prototype:tui-design -- explore   → all legacy variants
// Env: PROTOTYPE_WIDTH=<cols>  PROTOTYPE_THEME=dark|light

import stripAnsi from "strip-ansi";
import { initTheme } from "../dist/modes/interactive/theme/theme.js";
import {
	RETHINK_PROTOTYPES,
	lineStats,
	listPrototypeIds,
	renderPrototypeBanner,
	resolvePrototypeSet,
} from "../dist/modes/interactive/components/__prototype__/transcript-design-prototype.js";

function resolveWidth() {
	if (process.env.PROTOTYPE_WIDTH) {
		const n = Number(process.env.PROTOTYPE_WIDTH);
		if (Number.isFinite(n) && n > 0) return Math.floor(n);
	}
	const envCols = Number(process.env.COLUMNS);
	const cols =
		(process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : undefined) ??
		(Number.isFinite(envCols) && envCols > 0 ? envCols : 120);
	return Math.max(20, Math.floor(cols));
}

const themeName = process.env.PROTOTYPE_THEME === "light" ? "light" : "dark";
initTheme(themeName, false);

const width = resolveWidth();
const mode = process.argv[2] ?? "rethink";
const prototypes = resolvePrototypeSet(mode);

for (const prototype of prototypes) {
	const rendered = prototype.render(width);
	const stats = lineStats(rendered.map((line) => stripAnsi(line)));

	process.stdout.write(renderPrototypeBanner(prototype, width).join("\n"));
	process.stdout.write("\n");
	process.stdout.write(rendered.join("\n"));
	process.stdout.write("\n\n");
	process.stdout.write(
		`  lines: ${stats.total} total · ${stats.nonBlank} content · ${stats.blank} blank (${stats.total ? Math.round((stats.blank / stats.total) * 100) : 0}% air)\n`,
	);
	process.stdout.write("\n");
}

if (prototypes.length > 1) {
	process.stdout.write(`Rendered at ${width} columns.\n\n`);
	process.stdout.write("Rethink comparison:\n");
	for (const prototype of RETHINK_PROTOTYPES) {
		const stats = lineStats(prototype.render(width).map((line) => stripAnsi(line)));
		const mark = prototype.id === "gsd-connected" || prototype.id === "gsd-flow" ? "★" : " ";
		process.stdout.write(
			`  ${mark} ${prototype.id.padEnd(14)} ${String(stats.total).padStart(3)} lines (${stats.blank} blank)\n`,
		);
	}
	process.stdout.write("\n");
	process.stdout.write("Spec: packages/pi-coding-agent/src/modes/interactive/components/__prototype__/DESIGN-RETHINK.md\n");
	process.stdout.write("Pick: npm run prototype:tui-design -- gsd-flow\n");
	if (mode !== "explore") {
		process.stdout.write("Legacy variants: npm run prototype:tui-design -- explore\n");
	}
	process.stdout.write(`IDs: ${listPrototypeIds().join(", ")}\n`);
}

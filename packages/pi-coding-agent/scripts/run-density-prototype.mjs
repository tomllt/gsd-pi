#!/usr/bin/env node
// PROTOTYPE runner — compare transcript density variants in the terminal.
// Usage: npm run prototype:tui-density [-- all|current|compact|tight-tools|minimal]
// Env: PROTOTYPE_WIDTH=<cols>  PROTOTYPE_THEME=dark|light
// Width defaults to the terminal column count (full screen).

import stripAnsi from "strip-ansi";
import { initTheme } from "../dist/modes/interactive/theme/theme.js";
import {
	DENSITY_VARIANTS,
	getVariant,
	lineStats,
	renderSampleTranscript,
	renderVariantBanner,
} from "../dist/modes/interactive/components/__prototype__/transcript-density-prototype.js";

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
const arg = process.argv[2] ?? "all";
const variants = arg === "all" ? DENSITY_VARIANTS : [getVariant(arg)];

for (const variant of variants) {
	const rendered = renderSampleTranscript(width, variant);
	const stats = lineStats(rendered.map((line) => stripAnsi(line)));

	process.stdout.write(renderVariantBanner(variant, width).join("\n"));
	process.stdout.write("\n");
	process.stdout.write(rendered.join("\n"));
	process.stdout.write("\n\n");
	process.stdout.write(
		`  lines: ${stats.total} total · ${stats.nonBlank} content · ${stats.blank} blank (${Math.round((stats.blank / stats.total) * 100)}% air)\n`,
	);
	process.stdout.write("\n");
}

if (variants.length > 1) {
	process.stdout.write(`Rendered at ${width} columns.\n`);
	process.stdout.write("Compare variants:\n");
	for (const variant of DENSITY_VARIANTS) {
		const stats = lineStats(renderSampleTranscript(width, variant).map((line) => stripAnsi(line)));
		process.stdout.write(`  ${variant.id.padEnd(12)} ${String(stats.total).padStart(3)} lines (${stats.blank} blank)\n`);
	}
	process.stdout.write("\nPick one: npm run prototype:tui-density -- <variant-id>\n");
}

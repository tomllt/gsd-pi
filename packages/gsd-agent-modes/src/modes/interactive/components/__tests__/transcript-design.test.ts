// Project/App: gsd-pi
// File Purpose: Visual contract tests for shared transcript rendering primitives.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { padRight, truncateToWidth, visibleWidth } from "@gsd/pi-tui";
import { initTheme } from "@gsd/pi-coding-agent/theme/theme.js";
import { renderConnectedCard } from "../transcript-design.js";

initTheme("dark", false);

describe("renderConnectedCard", () => {
	test("keeps long ANSI body rows on the existing width contract", () => {
		const width = 32;
		const indent = 4;
		const line = `\x1b[36m${"abcdef ".repeat(8)}\x1b[0m`;

		const rendered = renderConnectedCard(width, "tool", [line], { indent, closeBottom: false });
		const body = rendered[1];
		const expectedInner = padRight(truncateToWidth("   " + line, width - indent, ""), width - indent);

		assert.ok(body, "expected a body row");
		assert.equal(body, " ".repeat(indent) + expectedInner);
		assert.equal(visibleWidth(body), width);
	});
});

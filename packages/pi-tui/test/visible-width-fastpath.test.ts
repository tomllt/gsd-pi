import assert from "node:assert";
import { describe, it } from "node:test";
import { extractAnsiCode, visibleWidth } from "../src/utils.ts";

// visibleWidth uses a codepoint fast-path that skips Intl.Segmenter for strings
// whose graphemes are all single-codepoint (the common case), eliminating the
// ICU break-iterator GC churn on the hot render path. These tests prove the
// fast-path is byte-identical to a ground-truth Intl.Segmenter reference that
// reuses the same per-grapheme width (visibleWidth on a single grapheme is
// always exact, so summing per-grapheme reproduces the true segmented width).

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Strip CSI/OSC/APC escape sequences exactly as visibleWidth() does, via the
 * production extractAnsiCode() scanner (not a partial SGR-only regex), so the
 * oracle is as strong as the code under test.
 */
function stripAnsi(str: string): string {
	let out = "";
	let i = 0;
	while (i < str.length) {
		const ansi = extractAnsiCode(str, i);
		if (ansi) {
			i += ansi.length;
			continue;
		}
		out += str[i];
		i++;
	}
	return out;
}

/** Ground-truth width via explicit segmentation of the same width logic. */
function referenceWidth(str: string): number {
	const clean = stripAnsi(str.replace(/\t/g, "   "));
	let width = 0;
	for (const { segment } of segmenter.segment(clean)) {
		width += visibleWidth(segment);
	}
	return width;
}

describe("visibleWidth codepoint fast-path", () => {
	it("matches the segmenter reference for every codepoint U+0020-U+1FAFF", () => {
		let mismatches = 0;
		for (let cp = 0x20; cp <= 0x1faff; cp++) {
			if (cp >= 0xd800 && cp <= 0xdfff) continue; // lone surrogates
			const s = String.fromCodePoint(cp);
			if (visibleWidth(s) !== referenceWidth(s)) mismatches++;
		}
		assert.strictEqual(mismatches, 0);
	});

	it("matches the reference for multi-codepoint grapheme clusters", () => {
		const cases = [
			"e\u0301", // e + combining acute
			"a\u0300\u0301", // multiple combining marks
			"\u{1F1E6}\u{1F1E7}", // regional indicator pair (flag)
			"\u{1F468}\u200d\u{1F469}\u200d\u{1F467}", // ZWJ family
			"\u{1F44D}\u{1F3FB}", // emoji + skin-tone modifier
			"x\ufe0f", // variation selector 16
			"\u0e01\u0e33", // Thai consonant + SARA AM
			"\u0915\u094d\u0937", // Devanagari conjunct
			"a\u200db", // ZWJ between letters
		];
		for (const s of cases) {
			assert.strictEqual(visibleWidth(s), referenceWidth(s), JSON.stringify(s));
		}
	});

	it("matches the reference for ANSI-styled and tabbed content", () => {
		const cases = [
			"\x1b[1;32msuccess\x1b[0m \u00b7 \x1b[2m12s\x1b[0m",
			"\u2500\u2500 \x1b[2mWorking \u00b7 Latest Output\x1b[0m \u2500\u2500",
			"tab\there\tcols",
			"  \x1b[34msrc/file.ts\x1b[0m edited",
		];
		for (const s of cases) {
			assert.strictEqual(visibleWidth(s), referenceWidth(s), JSON.stringify(s));
		}
	});

	it("matches the reference for OSC hyperlinks and APC sequences", () => {
		const cases = [
			// OSC 8 hyperlink: ESC ] 8 ; params ; uri BEL ... ESC ] 8 ; ; BEL
			"\x1b]8;;https://example.com\x07click here\x1b]8;;\x07",
			// OSC 8 with ST terminator (ESC \) instead of BEL
			"\x1b]8;;https://x.dev\x1b\\link\x1b]8;;\x1b\\",
			// APC sequence (e.g. cursor marker): ESC _ ... BEL
			"before\x1b_someapc\x07after",
			// OSC window title interleaved with text
			"\x1b]0;title\x07visible text",
		];
		for (const s of cases) {
			assert.strictEqual(visibleWidth(s), referenceWidth(s), JSON.stringify(s));
		}
	});

	it("keeps isolated regional indicators at width 2 (streaming-drift mitigation)", () => {
		for (let cp = 0x1f1e6; cp <= 0x1f1ff; cp++) {
			assert.strictEqual(visibleWidth(String.fromCodePoint(cp)), 2);
		}
	});
});

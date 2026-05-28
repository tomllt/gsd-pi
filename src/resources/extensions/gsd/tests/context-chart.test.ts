import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { SessionEntry } from "@gsd/pi-coding-agent";

import { buildContextChartHtml, writeContextChartHtml } from "../context-chart-html.ts";
import { formatContextChartText, getContextChartTotals } from "../context-overlay.ts";
import { buildContextBreakdown } from "../commands-context.ts";

const TS = 1;

function sessionEntries(...messages: unknown[]): SessionEntry[] {
  return messages.map((message, i) => ({
    type: "message",
    id: `entry-${i}`,
    parentId: i > 0 ? `entry-${i - 1}` : null,
    timestamp: new Date(TS).toISOString(),
    message,
  })) as unknown as SessionEntry[];
}

const SAMPLE_REPORT = buildContextBreakdown({
  modelLabel: "claude-code/claude-sonnet-4-6",
  provider: "claude-code",
  contextUsage: { tokens: 80_000, contextWindow: 200_000, percent: 40 },
  systemPrompt: [
    "Pi base",
    "<available_skills><skill><name>review</name></skill></available_skills>",
    "[SYSTEM CONTEXT — GSD]",
    "core",
    "[KNOWLEDGE — Rules]",
    "rule one",
  ].join("\n"),
  entries: sessionEntries(
    {
      role: "custom",
      customType: "gsd-memory",
      content: "auth memory block",
      display: false,
      timestamp: TS,
    },
    {
      role: "toolResult",
      toolCallId: "tc-1",
      toolName: "read",
      content: [{ type: "text", text: "large tool output ".repeat(20) }],
      isError: false,
      timestamp: TS,
    },
  ),
});

test("getContextChartTotals aggregates system and conversation buckets", () => {
  const totals = getContextChartTotals(SAMPLE_REPORT);
  assert.ok(totals.systemTokens > 0);
  assert.ok(totals.conversationTokens > 0);
  assert.equal(totals.inContext, 80_000);
  assert.equal(totals.remaining, 120_000);
});

test("buildContextChartHtml renders donut and bar chart markup", () => {
  const html = buildContextChartHtml(SAMPLE_REPORT);
  assert.match(html, /Context Breakdown/);
  assert.match(html, /class="donut"/);
  assert.match(html, /System prompt/);
  assert.match(html, /Conversation history/);
  assert.match(html, /class="bar-row"/);
  assert.match(html, /chip-loaded/);
});

test("writeContextChartHtml saves under .gsd/reports", () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-context-chart-"));
  const outPath = writeContextChartHtml(base, SAMPLE_REPORT);
  assert.match(outPath, /context-.*\.html$/);
  const saved = readFileSync(outPath, "utf-8");
  assert.match(saved, /Context Breakdown/);
});

test("formatContextChartText includes chart sections", () => {
  const text = formatContextChartText(SAMPLE_REPORT, 80);
  assert.match(text, /Context Breakdown/);
  assert.match(text, /System prompt/);
  assert.match(text, /Conversation/);
  assert.match(text, /█/);
});

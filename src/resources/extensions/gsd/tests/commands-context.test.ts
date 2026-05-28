import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SessionEntry } from "@gsd/pi-coding-agent";

import {
  analyzeSessionContext,
  buildContextBreakdown,
  formatContextReport,
  handleContext,
  parseSystemPromptSections,
} from "../commands-context.ts";

const PROVIDER = "openai" as const;
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

test("parseSystemPromptSections splits pi base, skills catalog, and GSD blocks", () => {
  const systemPrompt = [
    "You are Pi.",
    "<available_skills>",
    "  <skill><name>frontend-design</name><description>UI</description></skill>",
    "  <skill><name>tdd</name><description>Tests</description></skill>",
    "</available_skills>",
    "[SYSTEM CONTEXT — GSD]",
    "GSD core instructions here.",
    "GSD Skill Preferences",
    "prefer_skills: [\"tdd\"]",
    "[KNOWLEDGE — Rules from KNOWLEDGE.md]",
    "Always write tests.",
    "[PROJECT CODEBASE — File structure]",
    "src/index.ts",
  ].join("\n");

  const sections = parseSystemPromptSections(systemPrompt, PROVIDER);
  const labels = sections.map((section) => section.label);

  assert.ok(labels.includes("Pi base prompt"));
  assert.ok(labels.includes("Available skills catalog"));
  assert.ok(labels.includes("GSD system prompt"));
  assert.ok(labels.includes("Skill preferences"));
  assert.ok(labels.includes("Knowledge rules"));
  assert.ok(labels.includes("Codebase map"));

  const skills = sections.find((section) => section.label === "Available skills catalog");
  assert.equal(skills?.detail, "2 skills");
});

test("analyzeSessionContext buckets injections, tool results, and loaded skills", () => {
  const result = analyzeSessionContext(sessionEntries(
    {
      role: "custom",
      customType: "gsd-memory",
      content: "Memory block about auth patterns",
      display: false,
      timestamp: TS,
    },
    {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "tc-read",
          name: "read",
          arguments: { path: "/home/user/.agents/skills/tdd/SKILL.md" },
        },
        {
          type: "toolCall",
          id: "tc-subagent",
          name: "subagent",
          arguments: { task: "scout the repo" },
        },
      ],
      timestamp: TS,
    },
    {
      role: "toolResult",
      toolCallId: "tc-read",
      toolName: "read",
      content: [{ type: "text", text: "skill file contents here" }],
      isError: false,
      timestamp: TS,
    },
  ), PROVIDER);

  assert.ok(result.conversationSections.some((section) => section.label === "Memory injection"));
  assert.ok(result.conversationSections.some((section) => section.label === "Tool results"));
  assert.deepEqual(result.skills.loaded, ["tdd"]);
  assert.equal(result.subagentSpawns, 1);
});

test("formatContextReport lists skills and subagents", () => {
  const report = buildContextBreakdown({
    modelLabel: "claude-code/claude-sonnet-4-6",
    provider: "claude-code",
    contextUsage: { tokens: 80_000, contextWindow: 200_000, percent: 40 },
    systemPrompt: [
      "Pi base",
      "<available_skills><skill><name>review</name></skill></available_skills>",
      "[SYSTEM CONTEXT — GSD]",
      "core",
    ].join("\n"),
    entries: sessionEntries({
      role: "assistant",
      content: [{ type: "toolCall", id: "tc-subagent", name: "subagent", arguments: {} }],
      timestamp: TS,
    }),
  });

  const output = formatContextReport(report);
  assert.match(output, /Context Breakdown/);
  assert.match(output, /Available \(1\): review/);
  assert.match(output, /Subagent spawns this session: 1/);
});

test("buildContextBreakdown supports --json shape via handleContext data", () => {
  const report = buildContextBreakdown({
    modelLabel: null,
    provider: PROVIDER,
    contextUsage: undefined,
    systemPrompt: "",
    entries: [],
  });

  assert.deepEqual(report.skills, {
    available: [],
    loaded: [],
    prefer: [],
    avoid: [],
  });
  assert.equal(report.subagentSpawns, 0);
});

test("handleContext writes open reports under the command project root", async () => {
  const intendedProject = mkdtempSync(join(tmpdir(), "gsd-context-project-"));
  const processProject = mkdtempSync(join(tmpdir(), "gsd-context-cwd-"));
  for (const dir of [intendedProject, processProject]) {
    mkdirSync(join(dir, ".gsd"), { recursive: true });
    writeFileSync(join(dir, ".gsd", "PREFERENCES.md"), "");
  }

  const originalCwd = process.cwd();
  const originalPath = process.env.PATH;
  process.chdir(processProject);
  try {
    const binDir = mkdtempSync(join(tmpdir(), "gsd-context-bin-"));
    const xdgOpen = join(binDir, "xdg-open");
    writeFileSync(xdgOpen, "#!/bin/sh\nexit 0\n");
    chmodSync(xdgOpen, 0o755);
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    const notifications: string[] = [];
    const ctx = {
      model: undefined,
      getContextUsage: () => undefined,
      getSystemPrompt: () => "",
      hasUI: false,
      sessionManager: { getEntries: () => [] },
      ui: {
        notify: (message: string) => notifications.push(message),
      },
    } as any;

    await handleContext("--open", ctx, intendedProject);

    assert.ok(existsSync(join(intendedProject, ".gsd", "reports")));
    assert.equal(
      existsSync(join(processProject, ".gsd", "reports")),
      false,
      "must not write reports under process.cwd() when command cwd differs",
    );
    assert.ok(readdirSync(join(intendedProject, ".gsd", "reports")).some((name) => /^context-.*\.html$/.test(name)));
    assert.match(notifications[0] ?? "", new RegExp(intendedProject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    process.env.PATH = originalPath;
    process.chdir(originalCwd);
  }
});

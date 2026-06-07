import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SourceObservationStore,
  injectSourceContextBlockIntoPayload,
  observeSourcePath,
  planDeclaredSourceEntries,
} from "../source-observations.js";
import { AutoSession } from "../auto/session.js";
import { truncateContextResultMessages, truncateResponsesInputResultItems } from "../context-masker.js";
import type { TaskRow } from "../db-task-slice-rows.js";

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    milestone_id: "M001",
    slice_id: "S01",
    id: "T01",
    title: "Task",
    status: "pending",
    one_liner: "",
    narrative: "",
    verification_result: "",
    duration: "",
    completed_at: null,
    blocker_discovered: false,
    deviations: "",
    known_issues: "",
    key_files: [],
    key_decisions: [],
    full_summary_md: "",
    description: "",
    estimate: "",
    files: [],
    verify: "",
    inputs: [],
    expected_output: [],
    observability_impact: "",
    full_plan_md: "",
    sequence: 1,
    blocker_source: "",
    escalation_pending: 0,
    escalation_awaiting_review: 0,
    escalation_artifact_path: null,
    escalation_override_applied_at: null,
    ...overrides,
  };
}

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "gsd-source-observations-"));
}

function beginStore(basePath: string): SourceObservationStore {
  const store = new SourceObservationStore();
  store.beginUnit({ unitType: "execute-task", unitId: "M001/S01/T01", startedAt: 123, basePath });
  return store;
}

test("plan-declared source entries use task.files and concrete task.inputs, not expectedOutput", () => {
  const task = makeTask({
    files: ["src/app.ts"],
    inputs: ["Current enum shape", "`src/input.ts` - existing input"],
    expected_output: ["src/generated.ts"],
  });

  assert.deepEqual(planDeclaredSourceEntries(task), [
    { path: "src/app.ts", field: "files" },
    { path: "src/input.ts", field: "inputs" },
  ]);
});

test("preloaded plan observations render whole files and unavailable statuses", () => {
  const basePath = tempProject();
  mkdirSync(join(basePath, "src"), { recursive: true });
  writeFileSync(join(basePath, "src", "app.ts"), "export const value = 1;\n");
  mkdirSync(join(basePath, "src", "directory"), { recursive: true });
  writeFileSync(join(basePath, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const store = beginStore(basePath);
  store.observePlanTask(makeTask({
    files: [
      "src/app.ts",
      "src/missing.ts",
      "src/*.ts",
      "src/directory/",
      "image.png",
    ],
  }));

  const block = store.renderActiveBlock();
  assert.ok(block);
  assert.match(block, /## Source Context Block/);
  assert.match(block, /#### src\/app\.ts/);
  assert.match(block, /export const value = 1;/);
  assert.match(block, /src\/missing\.ts: missing/);
  assert.match(block, /src\/\*\.ts: glob/);
  assert.match(block, /src\/directory: directory/);
  assert.match(block, /image\.png: binary\/image/);
});

test("narrow reads of under-threshold files auto-upgrade to whole-file observations", () => {
  const basePath = tempProject();
  mkdirSync(join(basePath, "src"), { recursive: true });
  writeFileSync(join(basePath, "src", "app.ts"), ["line one", "line two", "line three"].join("\n"));

  const store = beginStore(basePath);
  store.observeRead({ path: "src/app.ts", offset: 2, limit: 1 });

  const block = store.renderActiveBlock();
  assert.ok(block);
  assert.match(block, /line one/);
  assert.match(block, /line two/);
  assert.match(block, /line three/);
});

test("successful file mutations refresh active whole-file observations", () => {
  const basePath = tempProject();
  writeFileSync(join(basePath, "app.ts"), "export const value = 'before';\n");

  const store = beginStore(basePath);
  store.observeRead({ path: "app.ts" });

  assert.match(store.renderActiveBlock() ?? "", /before/);

  writeFileSync(join(basePath, "app.ts"), "export const value = 'after';\n");
  store.observeMutation({ path: "app.ts" });

  const block = store.renderActiveBlock() ?? "";
  assert.match(block, /after/);
  assert.doesNotMatch(block, /before/);
});

test("successful writes promote missing plan observations to whole files", () => {
  const basePath = tempProject();
  const store = beginStore(basePath);
  store.observePlanTask(makeTask({ files: ["generated.ts"] }));

  assert.match(store.renderActiveBlock() ?? "", /generated\.ts: missing/);

  writeFileSync(join(basePath, "generated.ts"), "export const generated = true;\n");
  store.observeMutation({ path: "generated.ts" });

  const block = store.renderActiveBlock() ?? "";
  assert.match(block, /#### generated\.ts/);
  assert.match(block, /export const generated = true;/);
  assert.doesNotMatch(block, /generated\.ts: missing/);
});

test("over-threshold files are explicit unavailable observations", () => {
  const basePath = tempProject();
  writeFileSync(join(basePath, "large.txt"), "a".repeat(51 * 1024));

  const observation = observeSourcePath(basePath, "large.txt", "plan");

  assert.equal(observation.status, "over-threshold");
  assert.match(observation.reason ?? "", /exceeds/);
});

test("outside-root paths are unavailable and never inlined", () => {
  const root = tempProject();
  const basePath = join(root, "project");
  const outsidePath = join(root, "outside");
  mkdirSync(basePath, { recursive: true });
  mkdirSync(outsidePath, { recursive: true });
  writeFileSync(join(outsidePath, "secret.txt"), "do not inline me\n");

  const absoluteObservation = observeSourcePath(basePath, join(outsidePath, "secret.txt"), "read");
  const relativeObservation = observeSourcePath(basePath, "../outside/secret.txt", "read");

  assert.equal(absoluteObservation.status, "unresolved selector");
  assert.equal(relativeObservation.status, "unresolved selector");
  assert.match(absoluteObservation.reason ?? "", /outside active Unit root/);
  assert.match(relativeObservation.reason ?? "", /outside active Unit root/);
  assert.equal(absoluteObservation.text, undefined);
  assert.equal(relativeObservation.text, undefined);
});

test("source observations only render for execute-task units", () => {
  const basePath = tempProject();
  writeFileSync(join(basePath, "plan.md"), "planning context\n");

  const store = new SourceObservationStore();
  store.beginUnit({ unitType: "plan-slice", unitId: "M001/S01", startedAt: 123, basePath });
  store.observeRead({ path: "plan.md" });

  assert.equal(store.renderActiveBlock(), null);
});

test("source context block injection survives tool-result truncation for messages payloads", () => {
  const payload = {
    messages: truncateContextResultMessages([
      { role: "toolResult", content: [{ type: "text", text: "x".repeat(200) }], toolCallId: "read-1", toolName: "read", isError: false },
    ] as any, 10),
  };

  const injected = injectSourceContextBlockIntoPayload(payload, "## Source Context Block\n\nfull source text");

  assert.match((injected.messages as any[])[0].content[0].text, /truncated/);
  assert.equal((injected.messages as any[])[1].content[0].text, "## Source Context Block\n\nfull source text");
});

test("source context block injection supports Responses input payloads", () => {
  const payload = {
    input: truncateResponsesInputResultItems([
      { type: "function_call_output", call_id: "read-1", output: "x".repeat(200) },
    ] as any, 10),
  };

  const injected = injectSourceContextBlockIntoPayload(payload, "## Source Context Block\n\nfull source text");

  assert.match((injected.input as any[])[0].output, /truncated/);
  assert.equal((injected.input as any[])[1].content[0].text, "## Source Context Block\n\nfull source text");
});

test("unit-close degradation removes active whole-file source text", () => {
  const basePath = tempProject();
  writeFileSync(join(basePath, "app.ts"), "export const value = 1;");
  const store = beginStore(basePath);
  store.observeRead({ path: "app.ts" });

  assert.match(store.renderActiveBlock() ?? "", /export const value = 1/);

  store.degradeUnit({ unitType: "execute-task", unitId: "M001/S01/T01", startedAt: 123 });

  assert.equal(store.renderActiveBlock(), null);
});

test("AutoSession current-unit clear removes active source observations", () => {
  const basePath = tempProject();
  writeFileSync(join(basePath, "app.ts"), "export const value = 1;");
  const session = new AutoSession();
  session.basePath = basePath;
  session.setCurrentUnit({
    type: "execute-task",
    id: "M001/S01/T01",
    startedAt: 123,
    workspaceRoot: basePath,
  });
  session.sourceObservations.observeRead({ path: "app.ts" });

  assert.match(session.sourceObservations.renderActiveBlock() ?? "", /export const value = 1/);

  session.clearCurrentUnit();

  assert.equal(session.sourceObservations.renderActiveBlock(), null);
});

test("AutoSession clears source observations when switching to non-execute units", () => {
  const basePath = tempProject();
  writeFileSync(join(basePath, "app.ts"), "export const value = 1;");
  const session = new AutoSession();
  session.basePath = basePath;
  session.setCurrentUnit({
    type: "execute-task",
    id: "M001/S01/T01",
    startedAt: 123,
    workspaceRoot: basePath,
  });
  session.sourceObservations.observeRead({ path: "app.ts" });

  assert.match(session.sourceObservations.renderActiveBlock() ?? "", /export const value = 1/);

  session.setCurrentUnit({
    type: "plan-slice",
    id: "M001/S01",
    startedAt: 124,
    workspaceRoot: basePath,
  });

  assert.equal(session.sourceObservations.renderActiveBlock(), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mock } from "node:test";

import { postUnitPostVerification, type PostUnitContext } from "../auto-post-unit.ts";
import { AutoSession } from "../auto/session.ts";
import { checkPostUnitHooks, resetHookState, resolveHookArtifactPath } from "../post-unit-hooks.ts";
import { emitJournalEvent } from "../journal.ts";
import { _clearGsdRootCache } from "../paths.ts";
import { invalidateAllCaches } from "../cache.ts";

function writePreferences(basePath: string): void {
  const content = `---
post_unit_hooks:
  - name: review-arbiter
    after:
      - execute-task
    prompt: Review {taskId}
    agent: arbiter
    artifact: REVIEW-DEBATE.md
    retry_on: NEEDS-REWORK.md
    max_cycles: 3
    enabled: true
---
`;
  writeFileSync(join(basePath, ".gsd", "PREFERENCES.md"), content, "utf-8");
}

function writeFailingHookPreferences(basePath: string): void {
  const content = `---
post_unit_hooks:
  - name: review-arbiter
    after:
      - execute-task
    prompt: Review {taskId}
    artifact: REVIEW-DEBATE.md
    max_cycles: 1
    enabled: true
  - name: follow-up-review
    after:
      - execute-task
    prompt: Follow-up review {taskId}
    enabled: true
---
`;
  writeFileSync(join(basePath, ".gsd", "PREFERENCES.md"), content, "utf-8");
}

test("post-unit retry_on marks trigger unit as retry in orchestrator before redispatch", async () => {
  const originalCwd = process.cwd();
  const base = mkdtempSync(join(tmpdir(), "gsd-post-unit-retry-"));
  const taskDir = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks");
  mkdirSync(taskDir, { recursive: true });

  try {
    process.chdir(base);
    _clearGsdRootCache();
    invalidateAllCaches();
    resetHookState();
    writePreferences(base);

    const hookDispatch = checkPostUnitHooks("execute-task", "M001/S01/T01", base);
    assert.ok(hookDispatch, "hook should dispatch for execute-task");

    const retryPath = resolveHookArtifactPath(base, "M001/S01/T01", "NEEDS-REWORK.md");
    writeFileSync(retryPath, "rework requested", "utf-8");

    const retryActiveUnit = mock.fn(async (_unit: { unitType: string; unitId: string }) => {});
    const s = new AutoSession();
    s.basePath = base;
    s.active = true;
    s.currentUnit = { type: "hook/review-arbiter", id: "M001/S01/T01", startedAt: Date.now() };
    s.orchestration = {
      start: async () => ({ kind: "started" }),
      advance: async () => ({ kind: "stopped", reason: "unused" }),
      completeActiveUnit: async () => {},
      retryActiveUnit,
      resume: async () => ({ kind: "resumed" }),
      stop: async (reason: string) => ({ kind: "stopped", reason }),
      getStatus: () => ({ phase: "running", transitionCount: 0 }),
    };

    const pctx: PostUnitContext = {
      s,
      ctx: {
        ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {}, setFooter: () => {} },
        model: { id: "test-model" },
      } as any,
      pi: { sendMessage: async () => {}, setModel: async () => true } as any,
      buildSnapshotOpts: () => ({}),
      lockBase: () => base,
      stopAuto: async () => {},
      pauseAuto: async () => {},
      updateProgressWidget: () => {},
    };

    const result = await postUnitPostVerification(pctx);
    assert.equal(result, "continue");
    assert.equal(retryActiveUnit.mock.callCount(), 1);
    assert.deepEqual(retryActiveUnit.mock.calls[0]?.arguments[0], {
      unitType: "execute-task",
      unitId: "M001/S01/T01",
    });
  } finally {
    process.chdir(originalCwd);
    resetHookState();
    invalidateAllCaches();
    _clearGsdRootCache();
    rmSync(base, { recursive: true, force: true });
  }
});

test("failed post-unit hook pauses auto-mode even when its artifact exists", async () => {
  const originalCwd = process.cwd();
  const base = mkdtempSync(join(tmpdir(), "gsd-post-unit-hook-failed-"));
  const taskDir = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks");
  mkdirSync(taskDir, { recursive: true });

  try {
    process.chdir(base);
    _clearGsdRootCache();
    invalidateAllCaches();
    resetHookState();
    writeFailingHookPreferences(base);

    const hookDispatch = checkPostUnitHooks("execute-task", "M001/S01/T01", base);
    assert.equal(hookDispatch?.hookName, "review-arbiter");

    const artifactPath = resolveHookArtifactPath(base, "M001/S01/T01", "REVIEW-DEBATE.md");
    writeFileSync(artifactPath, "partial review", "utf-8");
    emitJournalEvent(base, {
      ts: "2026-06-03T12:00:00.000Z",
      flowId: "flow-hook-failed",
      seq: 3,
      eventType: "unit-end",
      data: {
        unitType: "hook/review-arbiter",
        unitId: "M001/S01/T01",
        status: "cancelled",
        artifactVerified: false,
      },
    });

    const pauseAuto = mock.fn(async () => {});
    const notifications: string[] = [];
    const s = new AutoSession();
    s.basePath = base;
    s.active = true;
    s.currentUnit = { type: "hook/review-arbiter", id: "M001/S01/T01", startedAt: Date.now() };

    const pctx: PostUnitContext = {
      s,
      ctx: {
        ui: {
          notify: (message: string) => { notifications.push(message); },
          setStatus: () => {},
          setWidget: () => {},
          setFooter: () => {},
        },
        model: { id: "test-model" },
      } as any,
      pi: { sendMessage: async () => {}, setModel: async () => true } as any,
      buildSnapshotOpts: () => ({}),
      lockBase: () => base,
      stopAuto: async () => {},
      pauseAuto,
      updateProgressWidget: () => {},
    };

    const result = await postUnitPostVerification(pctx);
    assert.equal(result, "stopped");
    assert.equal(pauseAuto.mock.callCount(), 1);
    assert.ok(
      notifications.some(message => message.includes("Post-unit hook review-arbiter failed")),
      "pause notification should explain the failed hook",
    );
  } finally {
    process.chdir(originalCwd);
    resetHookState();
    invalidateAllCaches();
    _clearGsdRootCache();
    rmSync(base, { recursive: true, force: true });
  }
});

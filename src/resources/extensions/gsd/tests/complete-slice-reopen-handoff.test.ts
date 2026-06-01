// Regression: complete-slice reopen/replan handoff must not artifact-retry (#183)

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { postUnitPreVerification } from "../auto-post-unit.ts";
import { AutoSession } from "../auto/session.ts";
import { cleanup, makeTempRepo } from "./test-utils.ts";

function makePostUnitContext(base: string, s: AutoSession, notifications: string[]) {
  return {
    s,
    ctx: { ui: { notify: (message: string) => notifications.push(message) } } as any,
    pi: {} as any,
    buildSnapshotOpts: () => ({}) as any,
    lockBase: () => base,
    stopAuto: async () => {},
    pauseAuto: async () => {},
    updateProgressWidget: () => {},
  };
}

test("complete-slice with gsd_task_reopen handoff continues instead of artifact-retrying", async () => {
  const base = makeTempRepo("gsd-complete-slice-reopen-");
  try {
    mkdirSync(join(base, ".gsd", "milestones", "M001", "slices", "S01"), { recursive: true });

    const s = new AutoSession();
    s.active = true;
    s.basePath = base;
    s.currentUnit = { type: "complete-slice", id: "M001/S01", startedAt: Date.now() };

    const retryKey = "complete-slice:M001/S01";
    s.verificationRetryCount.set(retryKey, 2);
    s.pendingVerificationRetry = {
      unitId: "M001/S01",
      failureContext: "Missing expected artifact (attempt 2/3).",
      attempt: 2,
    };

    const notifications: string[] = [];
    const result = await postUnitPreVerification(
      makePostUnitContext(base, s, notifications),
      {
        skipSettleDelay: true,
        skipWorktreeSync: true,
        agentEndMessages: [
          {
            role: "assistant",
            content: [{ type: "toolCall", name: "gsd_task_reopen", arguments: { taskId: "T01" } }],
          },
        ],
      },
    );

    assert.equal(result, "continue");
    assert.equal(s.pendingVerificationRetry, null);
    assert.equal(s.verificationRetryCount.has(retryKey), false);
    assert.ok(
      notifications.some((message) => message.includes("handed off via reopen/replan")),
      `expected handoff notification, got: ${notifications.join("\n")}`,
    );
  } finally {
    cleanup(base);
  }
});

test("complete-slice with gsd_replan_slice tool result continues instead of artifact-retrying", async () => {
  const base = makeTempRepo("gsd-complete-slice-replan-");
  try {
    const sliceDir = join(base, ".gsd", "milestones", "M001", "slices", "S01");
    mkdirSync(sliceDir, { recursive: true });
    writeFileSync(join(sliceDir, "S01-REPLAN.md"), "# Replan\n");

    const s = new AutoSession();
    s.active = true;
    s.basePath = base;
    s.currentUnit = { type: "complete-slice", id: "M001/S01", startedAt: Date.now() };

    const retryKey = "complete-slice:M001/S01";
    s.verificationRetryCount.set(retryKey, 1);

    const notifications: string[] = [];
    const result = await postUnitPreVerification(
      makePostUnitContext(base, s, notifications),
      {
        skipSettleDelay: true,
        skipWorktreeSync: true,
        agentEndMessages: [
          {
            role: "toolResult",
            toolName: "gsd_replan_slice",
            isError: false,
            content: "Slice replanned with reopened task T02.",
          },
        ],
      },
    );

    assert.equal(result, "continue");
    assert.equal(s.pendingVerificationRetry, null);
    assert.equal(s.verificationRetryCount.has(retryKey), false);
    assert.ok(
      notifications.some((message) => message.includes("valid replan outcome")),
      `expected handoff notification, got: ${notifications.join("\n")}`,
    );
  } finally {
    cleanup(base);
  }
});

test("complete-slice with gsd_replan_slice but no REPLAN artifact retries", async () => {
  const base = makeTempRepo("gsd-complete-slice-replan-missing-artifact-");
  try {
    mkdirSync(join(base, ".gsd", "milestones", "M001", "slices", "S01"), { recursive: true });

    const s = new AutoSession();
    s.active = true;
    s.basePath = base;
    s.currentUnit = { type: "complete-slice", id: "M001/S01", startedAt: Date.now() };

    const notifications: string[] = [];
    const result = await postUnitPreVerification(
      makePostUnitContext(base, s, notifications),
      {
        skipSettleDelay: true,
        skipWorktreeSync: true,
        agentEndMessages: [
          {
            role: "toolResult",
            toolName: "gsd_replan_slice",
            isError: false,
            content: "Slice replanned with reopened task T02.",
          },
        ],
      },
    );

    assert.equal(result, "retry");
    assert.ok(s.pendingVerificationRetry);
    assert.equal(s.pendingVerificationRetry?.unitId, "M001/S01");
  } finally {
    cleanup(base);
  }
});

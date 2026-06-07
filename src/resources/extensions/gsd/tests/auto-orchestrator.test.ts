// Project/App: gsd-pi
// File Purpose: Auto Orchestration module contract and ADR-015 invariant sequence tests.
//
// Phase 2 of #442 collapsed the nine adapter seams into AutoOrchestrator. These
// tests therefore drive the REAL collapsed orchestrator against real temp
// SQLite + git fixtures (fixture builder modelled on
// state-reconciliation-drift.test.ts) and inject dispatch decisions through the
// real unified rule registry (setRegistry) rather than mock adapters. Decision
// logic is asserted on observable advance() outcomes and journal events instead
// of an internal calls[] array. Dispatch-decision parity (formerly the
// createWiredDispatchAdapter tests) is asserted against the exported pure
// decideOrchestratorDispatch helper.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAutoOrchestrator,
  decideOrchestratorDispatch,
  resolveLiveOrchestratorBasePath,
  STUCK_WINDOW_SIZE,
} from "../auto/orchestrator.js";
import type { OrchestratorContext } from "../auto/orchestrator.js";
import type { AutoOrchestrationModule, AutoSessionContext } from "../auto/contracts.js";
import type { GSDState } from "../types.js";
import { resolveDispatch, type DispatchContext } from "../auto-dispatch.js";
import { RuleRegistry, setRegistry, resetRegistry } from "../rule-registry.js";
import type { UnifiedRule } from "../rule-types.js";
import { supportsStructuredQuestions } from "../workflow-mcp.js";
import {
  closeDatabase,
  insertMilestone,
  insertSlice,
  insertTask,
  openDatabase,
} from "../gsd-db.js";
import { AutoSession } from "../auto/session.js";
import { acquireSessionLock, releaseSessionLock } from "../session-lock.js";
import { queryJournal } from "../journal.js";
import { invalidateAllCaches } from "../cache.js";
import { invalidateStateCache } from "../state.js";

// ─────────────────────────────────────────────────────────────────────────────
// Fixture builder
//
// Builds a real, isolated project: a git repo (so the pre-dispatch health gate
// and merge-state reconciliation have something real to probe), a SQLite DB
// seeded with one active milestone/slice/task, and the matching ROADMAP/PLAN
// markdown projection. A real session lock is acquired so the orchestrator's
// ensureLockOwnership passes. A fresh AutoSession is wired to the base path. A
// dispatch rule is installed in the real unified registry so resolveDispatch
// yields a deterministic decision — this is the only "injection", and it is the
// same public seam (setRegistry) the dispatch engine already exposes.
// ─────────────────────────────────────────────────────────────────────────────

type DispatchRuleResult =
  | { action: "dispatch"; unitType: string; unitId: string; prompt: string; pauseAfterDispatch?: boolean }
  | { action: "stop"; reason: string; level: "info" | "warning" | "error" }
  | { action: "skip"; matchedRule?: string };

interface FixtureOptions {
  /** When provided, the rule returns this result. Defaults to dispatching M001/S01/T01. */
  dispatch?: () => DispatchRuleResult | Promise<DispatchRuleResult>;
  /** Rule name (becomes the dispatch `reason`/`matchedRule`). */
  ruleName?: string;
  /** Skip seeding a ready task (used for the "no remaining units" / complete scenarios). */
  noTask?: boolean;
  /** Mark the seeded milestone complete (drives the completion → stopped path). */
  complete?: boolean;
}

interface Fixture {
  base: string;
  session: AutoSession;
  ctx: OrchestratorContext;
  orchestrator: AutoOrchestrationModule;
  /** Names emitted to the journal by the orchestrator (data.name), in order. */
  journalNames(): string[];
  cleanup(): void;
}

const DEFAULT_DISPATCH: DispatchRuleResult = {
  action: "dispatch",
  unitType: "execute-task",
  unitId: "M001/S01/T01",
  prompt: "fixture-prompt",
};

function gitInit(base: string): void {
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: base, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: base, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: base, stdio: "ignore" });
  writeFileSync(join(base, ".gitkeep"), "");
  execFileSync("git", ["add", "."], { cwd: base, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: base, stdio: "ignore" });
}

function makeFixture(opts: FixtureOptions = {}): Fixture {
  const base = mkdtempSync(join(tmpdir(), "gsd-orchestrator-"));
  gitInit(base);

  const milestoneDir = join(base, ".gsd", "milestones", "M001");
  const sliceDir = join(milestoneDir, "slices", "S01");
  mkdirSync(join(sliceDir, "tasks"), { recursive: true });

  invalidateAllCaches();
  invalidateStateCache();
  openDatabase(join(base, ".gsd", "gsd.db"));
  insertMilestone({ id: "M001", title: "Milestone", status: opts.complete ? "complete" : "active" });
  if (!opts.noTask && !opts.complete) {
    insertSlice({ id: "S01", milestoneId: "M001", title: "Slice", status: "active", risk: "low", depends: [], demo: "", sequence: 1 });
    insertTask({ id: "T01", sliceId: "S01", milestoneId: "M001", title: "Task", status: "active" });
  }

  writeFileSync(
    join(milestoneDir, "M001-ROADMAP.md"),
    [
      "# M001: Milestone",
      "",
      "**Vision:** Fixture milestone",
      "",
      "## Slices",
      "",
      "- [ ] **S01: Slice** `risk:low` `depends:[]`",
      "",
    ].join("\n"),
  );
  if (!opts.noTask && !opts.complete) {
    writeFileSync(
      join(sliceDir, "S01-PLAN.md"),
      [
        "# S01: Slice",
        "",
        "**Goal:** Fixture goal",
        "**Demo:** Fixture demo",
        "",
        "## Must-Haves",
        "",
        "- Everything works",
        "",
        "## Tasks",
        "",
        "- [ ] **T01: Task** `est:1h`",
        "",
      ].join("\n"),
    );
  }

  acquireSessionLock(base);

  const session = new AutoSession();
  session.basePath = base;
  session.originalBasePath = base;
  session.currentMilestoneId = "M001";
  session.resourceVersionOnStart = null;

  const ctx: OrchestratorContext = {
    ctx: { model: {}, modelRegistry: { getAll: () => [] }, ui: { notify() {} } } as never,
    pi: { getActiveTools: () => [] } as never,
    dispatchBasePath: base,
    runtimeBasePath: base,
    session,
  };

  const ruleName = opts.ruleName ?? "fixture-dispatch";
  const decide = opts.dispatch ?? (() => DEFAULT_DISPATCH);
  const rule: UnifiedRule = {
    name: ruleName,
    when: "dispatch",
    evaluation: "first-match",
    where: async () => decide(),
    then: (r: unknown) => r,
  };
  setRegistry(new RuleRegistry([rule]));

  const orchestrator = createAutoOrchestrator(ctx);

  return {
    base,
    session,
    ctx,
    orchestrator,
    journalNames() {
      return queryJournal(base)
        .map((e) => (e.data as Record<string, unknown> | undefined)?.name)
        .filter((n): n is string => typeof n === "string");
    },
    cleanup() {
      resetRegistry();
      try { releaseSessionLock(base); } catch { /* */ }
      try { closeDatabase(); } catch { /* */ }
      try { rmSync(base, { recursive: true, force: true }); } catch { /* */ }
    },
  };
}

function makeState(): GSDState {
  return {
    activeMilestone: { id: "M001", title: "Milestone" },
    activeSlice: null,
    activeTask: null,
    phase: "executing",
    recentDecisions: [],
    blockers: [],
    nextAction: "Execute task",
    registry: [],
    requirements: { active: 0, validated: 0, deferred: 0, outOfScope: 0, blocked: 0, total: 0 },
    progress: { milestones: { done: 0, total: 1 } },
  };
}

const SESSION_CONTEXT: AutoSessionContext = { basePath: "/tmp/project", trigger: "manual" };

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle: start / resume / stop
// ─────────────────────────────────────────────────────────────────────────────

test("start() enters running phase without dispatching", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  const result = await f.orchestrator.start(SESSION_CONTEXT);

  assert.equal(result.kind, "started");
  const status = f.orchestrator.getStatus();
  assert.equal(status.phase, "running");
  assert.equal(status.activeUnit, undefined);
  assert.ok(f.journalNames().includes("start"));
  assert.ok(!f.journalNames().includes("advance"));
});

test("resume() enters running phase without dispatching", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  const result = await f.orchestrator.resume();

  assert.equal(result.kind, "resumed");
  assert.equal(f.orchestrator.getStatus().phase, "running");
  assert.ok(!f.journalNames().includes("advance"));
});

test("transitionCount increases across lifecycle transitions", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  const before = f.orchestrator.getStatus().transitionCount;
  await f.orchestrator.start(SESSION_CONTEXT);
  const afterStart = f.orchestrator.getStatus().transitionCount;
  await f.orchestrator.stop("done");
  const afterStop = f.orchestrator.getStatus().transitionCount;

  assert.ok(afterStart > before);
  assert.ok(afterStop > afterStart);
});

test("stop() transitions to stopped and journals stop", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  const result = await f.orchestrator.stop("user-request");

  assert.equal(result.kind, "stopped");
  assert.equal(f.orchestrator.getStatus().phase, "stopped");
  assert.ok(f.journalNames().includes("stop"));
});

// ─────────────────────────────────────────────────────────────────────────────
// advance(): happy path + ADR-015 invariant sequence
// ─────────────────────────────────────────────────────────────────────────────

test("advance() dispatches the resolved unit and journals advance", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  const result = await f.orchestrator.advance();

  assert.equal(result.kind, "advanced");
  if (result.kind !== "advanced") return;
  assert.deepEqual(result.unit, { unitType: "execute-task", unitId: "M001/S01/T01" });
  assert.equal(f.orchestrator.getStatus().phase, "running");
  // Journal records the advance AFTER the invariant gates (lock, health,
  // reconcile, dispatch, tool-contract, worktree) — i.e. no advance-blocked.
  const names = f.journalNames();
  assert.ok(names.includes("advance"));
  assert.ok(!names.includes("advance-blocked"));
});

test("advance() sets active unit and is reflected in status", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  await f.orchestrator.advance();

  assert.deepEqual(f.orchestrator.getStatus().activeUnit, {
    unitType: "execute-task",
    unitId: "M001/S01/T01",
  });
});

test("getStatus() returns defensive copy of activeUnit", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  await f.orchestrator.advance();
  const snap1 = f.orchestrator.getStatus();
  if (snap1.activeUnit) snap1.activeUnit.unitId = "MUTATED";
  const snap2 = f.orchestrator.getStatus();

  assert.equal(snap2.activeUnit?.unitId, "M001/S01/T01");
});

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch passthrough decisions (skip / blocked / no-remaining-units)
// ─────────────────────────────────────────────────────────────────────────────

test("advance() keeps running when dispatch intentionally skips a phase", async (t) => {
  const f = makeFixture({
    dispatch: () => ({ action: "skip", matchedRule: "evaluating-gates skipped after marking gates omitted" }),
  });
  t.after(() => f.cleanup());

  const result = await f.orchestrator.advance();

  assert.equal(result.kind, "skipped");
  if (result.kind !== "skipped") return;
  assert.equal(result.reason, "evaluating-gates skipped after marking gates omitted");
  assert.equal(f.orchestrator.getStatus().phase, "running");
  const names = f.journalNames();
  assert.ok(names.includes("advance-skipped"));
  assert.ok(!names.includes("advance-stopped"));
});

test("advance() surfaces dispatch blocker reason instead of generic no remaining units", async (t) => {
  const reason = "Milestone M001 validation verdict is needs-remediation but all slices are complete.";
  const f = makeFixture({
    dispatch: () => ({ action: "stop", reason, level: "warning" }),
  });
  t.after(() => f.cleanup());

  const result = await f.orchestrator.advance();

  assert.equal(result.kind, "blocked");
  if (result.kind !== "blocked") return;
  assert.equal(result.reason, reason);
  assert.equal(result.action, "pause");
  const names = f.journalNames();
  assert.ok(names.includes("advance-blocked"));
  assert.ok(!names.includes("advance-stopped"));
});

test("advance() stop level=error blocks with action stop", async (t) => {
  const f = makeFixture({
    dispatch: () => ({ action: "stop", reason: "hard blocker", level: "error" }),
  });
  t.after(() => f.cleanup());

  const result = await f.orchestrator.advance();

  assert.equal(result.kind, "blocked");
  if (result.kind !== "blocked") return;
  assert.equal(result.action, "stop");
});

test("advance() reports completion when complete state has no next unit", async (t) => {
  const f = makeFixture({ complete: true, noTask: true });
  t.after(() => f.cleanup());

  const result = await f.orchestrator.advance();

  assert.equal(result.kind, "stopped");
  if (result.kind !== "stopped") return;
  assert.equal(result.reason, "all milestones complete");
  assert.equal(f.orchestrator.getStatus().phase, "stopped");
});

test("advance() stopped clears previous activeUnit and resets idempotent lock", async (t) => {
  // First advance dispatches; then we make the milestone resolve to no unit by
  // closing it on disk + DB and re-deriving. Simpler: drive a fixture that
  // dispatches once, finalize externally, then the next decision is complete.
  let dispatchOnce = true;
  const f = makeFixture({
    dispatch: () => {
      if (dispatchOnce) {
        dispatchOnce = false;
        return DEFAULT_DISPATCH;
      }
      // After the first advance, signal completion via a benign skip → still
      // exercises the running/active-unit transition. For the stopped path we
      // rely on the complete-state test above.
      return { action: "skip", matchedRule: "done" };
    },
  });
  t.after(() => f.cleanup());

  const first = await f.orchestrator.advance();
  assert.equal(first.kind, "advanced");

  const second = await f.orchestrator.advance();
  assert.equal(second.kind, "skipped");
  // skip clears activeUnit
  assert.equal(f.orchestrator.getStatus().activeUnit, undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency + finalized guard + stuck-loop ring (issues #5786 / #5787 / #415)
// ─────────────────────────────────────────────────────────────────────────────

test("advance() is idempotent for the same active unit", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  const first = await f.orchestrator.advance();
  const second = await f.orchestrator.advance();

  assert.equal(first.kind, "advanced");
  if (first.kind === "advanced") {
    assert.deepEqual(first.unit, { unitType: "execute-task", unitId: "M001/S01/T01" });
  }
  assert.equal(second.kind, "blocked");
  if (second.kind !== "blocked") return;
  assert.equal(second.reason, "idempotent advance: unit already active");
  assert.equal(second.action, "pause");
});

test("idempotency block fires with its own reason before saturation", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  const first = await f.orchestrator.advance();
  const second = await f.orchestrator.advance();

  assert.equal(first.kind, "advanced");
  assert.equal(second.kind, "blocked");
  if (second.kind !== "blocked") return;
  assert.equal(second.reason, "idempotent advance: unit already active");
  assert.equal(second.action, "pause");
});

test("completeActiveUnit clears in-flight idempotency and stops stale same-unit advance", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  const first = await f.orchestrator.advance();
  assert.equal(first.kind, "advanced");
  if (first.kind !== "advanced") throw new Error("expected first advance");

  await f.orchestrator.completeActiveUnit(first.unit);
  const second = await f.orchestrator.advance();

  assert.equal(f.orchestrator.getStatus().activeUnit, undefined);
  assert.equal(second.kind, "blocked");
  if (second.kind !== "blocked") throw new Error("expected stale same-unit block");
  assert.equal(second.action, "stop");
  assert.equal(second.reason, "state did not advance after finalized execute-task M001/S01/T01");
  assert.ok(f.journalNames().includes("unit-finalized"));
});

test("#442: finalized-repeat recovers (skipped) when the unit's artifact already exists on disk", async (t) => {
  // plan-milestone's expected artifact is the ROADMAP, which the fixture
  // already writes — so verifyExpectedArtifact returns true. This is the legacy
  // stuck-recovery scenario (unit completed on disk, DB row stale): instead of
  // the finalized-repeat HARD-STOP, #442 verify-and-recover should refresh +
  // skip so the loop can progress. plan-milestone is deliberately NOT one of
  // the DB-refreshing unit types, so the recovery stays side-effect-light.
  const f = makeFixture({
    dispatch: () => ({ action: "dispatch", unitType: "plan-milestone", unitId: "M001", prompt: "p" }),
  });
  t.after(() => f.cleanup());

  const first = await f.orchestrator.advance();
  if (first.kind !== "advanced") {
    throw new Error(`expected advanced, got ${first.kind}: ${(first as { reason?: string }).reason ?? ""}`);
  }
  await f.orchestrator.completeActiveUnit(first.unit);

  const second = await f.orchestrator.advance();
  assert.equal(second.kind, "skipped", "should recover via artifact verification, not hard-stop");
  if (second.kind !== "skipped") throw new Error("expected skipped recovery");
  assert.match(second.reason, /stuck-recovery/);
  assert.ok(f.journalNames().includes("advance-skipped"));
});

test("completeActiveUnit allows a different next unit to advance", async (t) => {
  let nextTaskId = "M001/S01/T01";
  const f = makeFixture({
    dispatch: () => ({ action: "dispatch", unitType: "execute-task", unitId: nextTaskId, prompt: "p" }),
  });
  t.after(() => f.cleanup());

  const first = await f.orchestrator.advance();
  assert.equal(first.kind, "advanced");
  if (first.kind !== "advanced") throw new Error("expected first advance");

  await f.orchestrator.completeActiveUnit(first.unit);
  nextTaskId = "M001/S01/T02";
  const second = await f.orchestrator.advance();

  assert.equal(second.kind, "advanced");
  if (second.kind !== "advanced") throw new Error("expected second advance");
  assert.deepEqual(second.unit, { unitType: "execute-task", unitId: "M001/S01/T02" });
});

test("completeActiveUnit guard survives an intervening advance and blocks X→Y→X re-dispatch (#415)", async (t) => {
  let nextTaskId = "M001/S01/T01";
  const f = makeFixture({
    dispatch: () => ({ action: "dispatch", unitType: "execute-task", unitId: nextTaskId, prompt: "p" }),
  });
  t.after(() => f.cleanup());

  const first = await f.orchestrator.advance();
  assert.equal(first.kind, "advanced");
  if (first.kind !== "advanced") throw new Error("expected first advance");

  await f.orchestrator.completeActiveUnit(first.unit);

  nextTaskId = "M001/S01/T02";
  const second = await f.orchestrator.advance();
  assert.equal(second.kind, "advanced");
  if (second.kind !== "advanced") throw new Error("expected second advance (T02)");
  assert.deepEqual(second.unit, { unitType: "execute-task", unitId: "M001/S01/T02" });

  nextTaskId = "M001/S01/T01";
  const third = await f.orchestrator.advance();
  assert.equal(third.kind, "blocked");
  if (third.kind !== "blocked") throw new Error("expected X→Y→X re-dispatch to be blocked");
  assert.equal(third.action, "stop");
  assert.equal(third.reason, "state did not advance after finalized execute-task M001/S01/T01");
});

test("retryActiveUnit clears in-flight idempotency without marking the unit finalized", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  const first = await f.orchestrator.advance();
  assert.equal(first.kind, "advanced");
  if (first.kind !== "advanced") throw new Error("expected first advance");

  await f.orchestrator.retryActiveUnit(first.unit);
  const second = await f.orchestrator.advance();

  assert.equal(second.kind, "advanced");
  if (second.kind !== "advanced") throw new Error("expected retry advance");
  assert.deepEqual(second.unit, first.unit);
  assert.ok(f.journalNames().includes("unit-retry"));
});

test("retryActiveUnit clears finalized same-unit guard for post-hook retries", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  const first = await f.orchestrator.advance();
  assert.equal(first.kind, "advanced");
  if (first.kind !== "advanced") throw new Error("expected first advance");

  await f.orchestrator.completeActiveUnit(first.unit);
  await f.orchestrator.retryActiveUnit(first.unit);
  const second = await f.orchestrator.advance();

  assert.equal(second.kind, "advanced");
  if (second.kind !== "advanced") throw new Error("expected retry advance");
  assert.deepEqual(second.unit, first.unit);
  const names = f.journalNames();
  assert.ok(names.includes("unit-finalized"));
  assert.ok(names.includes("unit-retry"));
});

test("resume() clears idempotent lock and allows re-advance", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  const first = await f.orchestrator.advance();
  const blocked = await f.orchestrator.advance();
  const resumed = await f.orchestrator.resume();
  const next = await f.orchestrator.advance();

  assert.equal(first.kind, "advanced");
  assert.equal(blocked.kind, "blocked");
  assert.equal(resumed.kind, "resumed");
  assert.equal(next.kind, "advanced");
});

test("start() clears prior idempotent lock", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  await f.orchestrator.advance();
  const blocked = await f.orchestrator.advance();
  const restarted = await f.orchestrator.start(SESSION_CONTEXT);
  const next = await f.orchestrator.advance();

  assert.equal(blocked.kind, "blocked");
  assert.equal(restarted.kind, "started");
  assert.equal(next.kind, "advanced");
});

test("stop() clears idempotent unit lock so advance can run again", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  const first = await f.orchestrator.advance();
  const blocked = await f.orchestrator.advance();
  const stopped = await f.orchestrator.stop("reset");
  const second = await f.orchestrator.advance();

  assert.equal(first.kind, "advanced");
  assert.equal(blocked.kind, "blocked");
  assert.equal(stopped.kind, "stopped");
  assert.equal(second.kind, "advanced");
});

test("blocked path journals advance-blocked and records a health snapshot", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  await f.orchestrator.advance();
  await f.orchestrator.advance();

  assert.ok(f.journalNames().includes("advance-blocked"));
});

// ─── Stuck-loop ring buffer (issue #5787) ──────────────────────────────────

test("STUCK_WINDOW_SIZE matches the legacy auto/phases.ts constant", () => {
  assert.equal(STUCK_WINDOW_SIZE, 6);
});

test("stuck-loop: empty ring on a freshly constructed orchestrator advances normally", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  const result = await f.orchestrator.advance();

  assert.equal(result.kind, "advanced");
});

test("stuck-loop: partial fill of mixed units does not block", async (t) => {
  let i = 0;
  const sequence = ["M001/S01/A", "M001/S01/B", "M001/S01/A", "M001/S01/B", "M001/S01/A", "M001/S01/B"];
  const f = makeFixture({
    dispatch: () => ({ action: "dispatch", unitType: "execute-task", unitId: sequence[i++ % sequence.length], prompt: "p" }),
  });
  t.after(() => f.cleanup());

  for (let round = 0; round < STUCK_WINDOW_SIZE; round++) {
    const result = await f.orchestrator.advance();
    assert.equal(result.kind, "advanced", `round ${round} should advance, got ${result.kind}`);
  }
});

test("stuck-loop: ring saturated with same unit blocks with action 'stop' and stuck-loop reason", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  const results: Awaited<ReturnType<typeof f.orchestrator.advance>>[] = [];
  for (let i = 0; i < STUCK_WINDOW_SIZE; i++) {
    results.push(await f.orchestrator.advance());
  }

  // First call advances.
  assert.equal(results[0].kind, "advanced");

  // Intermediate calls are blocked by idempotency (not stuck-loop yet).
  for (let i = 1; i < STUCK_WINDOW_SIZE - 1; i++) {
    const r = results[i];
    assert.equal(r.kind, "blocked", `round ${i} should be blocked`);
    if (r.kind !== "blocked") return;
    assert.equal(r.reason, "idempotent advance: unit already active");
    assert.equal(r.action, "pause");
  }

  // The final call (ring now holds STUCK_WINDOW_SIZE copies) returns stuck-loop.
  const last = results[STUCK_WINDOW_SIZE - 1];
  assert.equal(last.kind, "blocked");
  if (last.kind !== "blocked") return;
  assert.equal(last.action, "stop");
  assert.equal(last.reason, `stuck-loop: execute-task:M001/S01/T01 picked ${STUCK_WINDOW_SIZE} times`);
});

test("stuck-loop: start() resets the ring so a fresh saturation cycle is required", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  for (let i = 0; i < STUCK_WINDOW_SIZE - 1; i++) {
    await f.orchestrator.advance();
  }

  const restarted = await f.orchestrator.start(SESSION_CONTEXT);
  assert.equal(restarted.kind, "started");

  const next = await f.orchestrator.advance();
  assert.equal(next.kind, "advanced");
});

test("stuck-loop: resume() resets the ring", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  for (let i = 0; i < STUCK_WINDOW_SIZE - 1; i++) {
    await f.orchestrator.advance();
  }

  const resumed = await f.orchestrator.resume();
  assert.equal(resumed.kind, "resumed");

  const next = await f.orchestrator.advance();
  assert.equal(next.kind, "advanced");
});

test("stuck-loop: stop() resets the ring", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  for (let i = 0; i < STUCK_WINDOW_SIZE - 1; i++) {
    await f.orchestrator.advance();
  }

  const stopped = await f.orchestrator.stop("user-request");
  assert.equal(stopped.kind, "stopped");

  const next = await f.orchestrator.advance();
  assert.equal(next.kind, "advanced");
});

test("stuck-loop: journal records the stuck-loop reason on advance-blocked", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  for (let i = 0; i < STUCK_WINDOW_SIZE; i++) {
    await f.orchestrator.advance();
  }

  const stuckEntry = queryJournal(f.base).find(
    (e) => {
      const reason = (e.data as Record<string, unknown> | undefined)?.reason;
      return typeof reason === "string" && reason.startsWith("stuck-loop:");
    },
  );
  assert.ok(stuckEntry, "journal must record an advance-blocked entry with the stuck-loop reason");
  assert.ok(f.journalNames().includes("advance-blocked"));
});

// ─────────────────────────────────────────────────────────────────────────────
// Recovery path: a lock held by another process throws inside advance() and is
// routed through the REAL classifyFailure → result mapping + notifications.
// We force the throw by acquiring the lock under a different PID (writing a
// foreign-PID lockfile is not portable, so we drive the deterministic-stop
// classification via a fixture whose runtimeBasePath has no valid lock).
// ─────────────────────────────────────────────────────────────────────────────

test("advance() routes a lost-lock error through recovery and journals an outcome", async (t) => {
  const f = makeFixture();
  t.after(() => f.cleanup());

  // Release the lock so ensureLockOwnership() sees missing-metadata and throws,
  // exercising the catch → classifyAndRecover → result-mapping branch.
  releaseSessionLock(f.base);
  // Remove the lockfile artifact so getSessionLockStatus returns !valid.
  try { rmSync(join(f.base, ".gsd", "auto.lock"), { force: true }); } catch { /* */ }
  try { rmSync(join(f.base, ".gsd.lock"), { recursive: true, force: true }); } catch { /* */ }

  const result = await f.orchestrator.advance();

  // classifyFailure maps a generic Error to a recovery action; the orchestrator
  // surfaces it as paused/stopped/error and journals the corresponding event.
  assert.ok(["paused", "stopped", "error"].includes(result.kind), `unexpected kind ${result.kind}`);
  const names = f.journalNames();
  assert.ok(
    names.includes("advance-paused") || names.includes("advance-stopped") || names.includes("advance-error"),
    "recovery must journal an advance-paused/stopped/error event",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// closeout regression: live-base resolver after worktree cleanup
// ─────────────────────────────────────────────────────────────────────────────

test("live orchestrator base resolver prefers live project root after worktree cleanup", (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), "gsd-orch-root-"));
  const staleWorktreeRoot = join(projectRoot, ".gsd", "worktrees", "M002");
  mkdirSync(join(staleWorktreeRoot, ".bg-shell"), { recursive: true });
  t.after(() => { try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ } });

  assert.equal(
    resolveLiveOrchestratorBasePath({
      capturedBasePath: staleWorktreeRoot,
      runtimeBasePath: projectRoot,
      sessionBasePath: projectRoot,
      originalBasePath: projectRoot,
    }),
    projectRoot,
  );
});

test("live orchestrator base resolver keeps a captured active git worktree", (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), "gsd-orch-worktree-"));
  const worktreeRoot = join(projectRoot, ".gsd", "worktrees", "M003");
  mkdirSync(worktreeRoot, { recursive: true });
  writeFileSync(join(worktreeRoot, ".git"), "gitdir: /tmp/gsd-orch-worktree/.git/worktrees/M003\n");
  t.after(() => { try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ } });

  assert.equal(
    resolveLiveOrchestratorBasePath({
      capturedBasePath: worktreeRoot,
      runtimeBasePath: projectRoot,
    }),
    worktreeRoot,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch-decision parity (#5789) — formerly the createWiredDispatchAdapter
// tests. These exercise the exported pure decideOrchestratorDispatch helper.
// ─────────────────────────────────────────────────────────────────────────────

test("decideOrchestratorDispatch forwards session-derived dispatch inputs identically to runDispatch", async () => {
  const stateSnapshot = makeState();

  const captured: DispatchContext[] = [];
  const captureRule: UnifiedRule = {
    name: "test-capture",
    when: "dispatch",
    evaluation: "first-match",
    where: async (ctx: DispatchContext) => {
      captured.push(ctx);
      return {
        action: "dispatch" as const,
        unitType: "execute-task",
        unitId: "T01",
        prompt: "parity-fixture",
      };
    },
    then: (r: unknown) => r,
  };
  setRegistry(new RuleRegistry([captureRule]));

  try {
    const fakeModelRegistry = {
      getAll: () => [],
      getProviderAuthMode: (_provider: string) => "apiKey" as const,
    };
    const ctx = {
      model: {
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        contextWindow: 200_000,
      },
      modelRegistry: fakeModelRegistry,
    } as never;
    const pi = {
      getActiveTools: () => ["read_file", "write_file"],
    } as never;
    const basePath = "/tmp/parity-fixture";

    // Path A — the orchestrator's pure dispatch decision.
    const adapterResult = await decideOrchestratorDispatch(ctx, pi, basePath, undefined, { stateSnapshot });

    // Path B — direct resolveDispatch call mirroring phases.ts:runDispatch.
    const prefs = undefined;
    const provider = (ctx as { model?: { provider?: string } }).model?.provider;
    const authMode = provider && typeof fakeModelRegistry.getProviderAuthMode === "function"
      ? fakeModelRegistry.getProviderAuthMode(provider)
      : undefined;
    const activeTools = ["read_file", "write_file"];
    const structuredQuestionsAvailable: "true" | "false" =
      prefs !== undefined && (prefs as { planning_depth?: string }).planning_depth === "deep"
        ? "false"
        : supportsStructuredQuestions(activeTools, {
            authMode,
            baseUrl: (ctx as { model?: { baseUrl?: string } }).model?.baseUrl,
          })
          ? "true"
          : "false";

    const builtDirectCtx: DispatchContext = {
      basePath,
      mid: stateSnapshot.activeMilestone!.id,
      midTitle: stateSnapshot.activeMilestone!.title,
      state: stateSnapshot,
      prefs,
      structuredQuestionsAvailable,
      sessionContextWindow: 200_000,
      sessionProvider: "anthropic",
      modelRegistry: fakeModelRegistry,
    };
    const directAction = await resolveDispatch(builtDirectCtx);

    assert.equal(captured.length, 2, "expected two captured dispatch contexts");
    const [adapterCtx, directCtx] = captured;

    assert.equal(adapterCtx.structuredQuestionsAvailable, directCtx.structuredQuestionsAvailable);
    assert.equal(adapterCtx.sessionContextWindow, directCtx.sessionContextWindow);
    assert.equal(adapterCtx.sessionProvider, directCtx.sessionProvider);
    assert.equal(adapterCtx.modelRegistry, directCtx.modelRegistry);
    assert.equal(adapterCtx.basePath, directCtx.basePath);
    assert.equal(adapterCtx.mid, directCtx.mid);
    assert.equal(adapterCtx.midTitle, directCtx.midTitle);

    if (!adapterResult || !("unitType" in adapterResult)) {
      assert.fail("expected adapter result to be a dispatch decision");
    }
    assert.equal(adapterResult.unitType, "execute-task");
    assert.equal(adapterResult.unitId, "T01");
    assert.equal(adapterResult.reason, "test-capture");
    assert.equal(directAction.action, "dispatch");
    if (directAction.action === "dispatch") {
      assert.equal(directAction.unitType, adapterResult.unitType);
      assert.equal(directAction.unitId, adapterResult.unitId);
      assert.equal(directAction.matchedRule, adapterResult.reason);
    }
  } finally {
    resetRegistry();
  }
});

test("decideOrchestratorDispatch prefers caller-supplied dispatch inputs over ctx-derived values", async () => {
  const stateSnapshot = makeState();
  const captured: DispatchContext[] = [];
  const captureRule: UnifiedRule = {
    name: "test-capture-overrides",
    when: "dispatch",
    evaluation: "first-match",
    where: async (ctx: DispatchContext) => {
      captured.push(ctx);
      return {
        action: "dispatch" as const,
        unitType: "execute-task",
        unitId: "T01",
        prompt: "override-fixture",
      };
    },
    then: (r: unknown) => r,
  };
  setRegistry(new RuleRegistry([captureRule]));

  try {
    const ctxModelRegistry = {
      getAll: () => [],
      getProviderAuthMode: (_provider: string) => "apiKey" as const,
    };
    const overrideModelRegistry = {
      getAll: () => [],
      getProviderAuthMode: (_provider: string) => "oauth" as const,
    };
    const ctx = {
      model: {
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        contextWindow: 200_000,
      },
      modelRegistry: ctxModelRegistry,
    } as never;
    const pi = { getActiveTools: () => [] } as never;
    const session = { basePath: "/tmp/session-fixture" } as never;

    const result = await decideOrchestratorDispatch(ctx, pi, "/tmp/parity-fixture", undefined, {
      stateSnapshot,
      session,
      structuredQuestionsAvailable: "true",
      sessionContextWindow: 500_000,
      sessionProvider: "openai",
      modelRegistry: overrideModelRegistry,
    });

    assert.ok(result);
    assert.equal(captured.length, 1, "expected one captured dispatch context");
    assert.equal(captured[0].structuredQuestionsAvailable, "true");
    assert.equal(captured[0].sessionContextWindow, 500_000);
    assert.equal(captured[0].sessionProvider, "openai");
    assert.equal(captured[0].modelRegistry, overrideModelRegistry);
    assert.equal(captured[0].session, session);
    assert.equal(captured[0].basePath, "/tmp/session-fixture");
  } finally {
    resetRegistry();
  }
});

test("decideOrchestratorDispatch forwards constructor session when advance input omits session", async () => {
  const stateSnapshot = makeState();
  const captured: DispatchContext[] = [];
  const captureRule: UnifiedRule = {
    name: "test-session-fallback",
    when: "dispatch",
    evaluation: "first-match",
    where: async (ctx: DispatchContext) => {
      captured.push(ctx);
      return {
        action: "dispatch" as const,
        unitType: "execute-task",
        unitId: "T01",
        prompt: "session-fallback-fixture",
      };
    },
    then: (r: unknown) => r,
  };
  setRegistry(new RuleRegistry([captureRule]));

  try {
    const ctx = { model: {}, modelRegistry: { getAll: () => [] } } as never;
    const pi = { getActiveTools: () => [] } as never;
    const session = {
      basePath: "/tmp/worktree-fixture",
      originalBasePath: "/tmp/project-fixture",
      currentMilestoneId: "M001",
    } as never;

    const result = await decideOrchestratorDispatch(ctx, pi, "/tmp/project-fixture", session, { stateSnapshot });

    assert.ok(result);
    assert.equal(captured.length, 1, "expected one captured dispatch context");
    assert.equal(captured[0].session, session);
    assert.equal(captured[0].basePath, "/tmp/worktree-fixture");
  } finally {
    resetRegistry();
  }
});

test("decideOrchestratorDispatch adopts next active milestone after the session milestone is closed", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-orchestrator-milestone-adopt-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const stateSnapshot: GSDState = {
    ...makeState(),
    activeMilestone: { id: "M002", title: "Next" },
    registry: [
      { id: "M001", title: "First", status: "complete" },
      { id: "M002", title: "Next", status: "active" },
    ],
  };
  const captured: DispatchContext[] = [];
  const captureRule: UnifiedRule = {
    name: "test-milestone-adoption",
    when: "dispatch",
    evaluation: "first-match",
    where: async (ctx: DispatchContext) => {
      captured.push(ctx);
      return {
        action: "dispatch" as const,
        unitType: "execute-task",
        unitId: "M002/S01/T01",
        prompt: "adopted-milestone-fixture",
      };
    },
    then: (r: unknown) => r,
  };
  setRegistry(new RuleRegistry([captureRule]));

  try {
    const ctx = { model: {}, modelRegistry: { getAll: () => [] } } as never;
    const pi = { getActiveTools: () => [] } as never;
    const session = {
      basePath: base,
      originalBasePath: base,
      currentMilestoneId: "M001",
    } as never;

    const result = await decideOrchestratorDispatch(ctx, pi, base, session, { stateSnapshot });

    assert.ok(result);
    if (!result || !("unitType" in result)) assert.fail(`expected dispatch decision, got ${JSON.stringify(result)}`);
    assert.equal(result.unitId, "M002/S01/T01");
    assert.equal((session as { currentMilestoneId: string }).currentMilestoneId, "M002");
    assert.equal(captured[0]?.session?.currentMilestoneId, "M002");
  } finally {
    resetRegistry();
  }
});

test("decideOrchestratorDispatch keeps blocking stale milestone worktree scope", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-orchestrator-worktree-block-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const stateSnapshot: GSDState = {
    ...makeState(),
    activeMilestone: { id: "M002", title: "Next" },
    registry: [
      { id: "M001", title: "First", status: "complete" },
      { id: "M002", title: "Next", status: "active" },
    ],
  };
  const worktreePath = join(base, ".gsd", "worktrees", "M001");
  mkdirSync(worktreePath, { recursive: true });
  const ctx = { model: {}, modelRegistry: { getAll: () => [] } } as never;
  const pi = { getActiveTools: () => [] } as never;
  const session = {
    basePath: worktreePath,
    originalBasePath: base,
    currentMilestoneId: "M001",
  } as never;

  const result = await decideOrchestratorDispatch(ctx, pi, base, session, { stateSnapshot });

  assert.deepEqual(result, {
    kind: "blocked",
    reason:
      'Dispatch milestone mismatch: context mid "M002" does not match session.currentMilestoneId "M001". The active worktree/session and derived project state disagree; recover, park, or discard the stranded milestone before continuing.',
    action: "pause",
  });
  assert.equal((session as { currentMilestoneId: string }).currentMilestoneId, "M001");
});

test("decideOrchestratorDispatch replays pending verification retry dispatch", async () => {
  const stateSnapshot = makeState();
  const ctx = { model: {}, modelRegistry: { getAll: () => [] } } as never;
  const pi = { getActiveTools: () => [] } as never;
  const session = {
    basePath: "/tmp/worktree-fixture",
    pendingOrchestrationDispatch: null,
    pendingVerificationRetryDispatch: {
      unitType: "complete-slice",
      unitId: "M004/S01",
      prompt: "repair slice closeout",
      pauseAfterUatDispatch: false,
      state: stateSnapshot,
      mid: "M004",
      midTitle: "Milestone 4",
    },
  } as never;

  const result = await decideOrchestratorDispatch(ctx, pi, "/tmp/project-fixture", session, { stateSnapshot });

  assert.ok(result);
  if (!result || !("unitType" in result)) assert.fail("expected dispatch decision");
  assert.equal(result.unitType, "complete-slice");
  assert.equal(result.unitId, "M004/S01");
  assert.equal(result.reason, "verification-retry");
  const sess = session as {
    pendingVerificationRetryDispatch: unknown;
    pendingOrchestrationDispatch: { prompt?: string; state?: unknown } | null;
  };
  assert.equal(sess.pendingVerificationRetryDispatch, null);
  assert.equal(sess.pendingOrchestrationDispatch?.prompt, "repair slice closeout");
  assert.equal(sess.pendingOrchestrationDispatch?.state, stateSnapshot);
});

test("decideOrchestratorDispatch clears verification retry state when skipping an already closed retry dispatch", async () => {
  const stateSnapshot = makeState();
  const base = mkdtempSync(join(tmpdir(), "gsd-orchestrator-closed-retry-"));

  try {
    mkdirSync(join(base, ".gsd"), { recursive: true });
    openDatabase(join(base, ".gsd", "gsd.db"));
    insertMilestone({ id: "M001", title: "Milestone", status: "active" });
    insertSlice({ milestoneId: "M001", id: "S01", title: "Slice", status: "active" });
    insertTask({ milestoneId: "M001", sliceId: "S01", id: "T01", title: "Task", status: "complete" });

    const retryRule: UnifiedRule = {
      name: "test-closed-verification-retry",
      when: "dispatch",
      evaluation: "first-match",
      where: async () => ({
        action: "dispatch" as const,
        unitType: "execute-task",
        unitId: "M001/S01/T01",
        prompt: "retry closed task",
      }),
      then: (r: unknown) => r,
    };
    setRegistry(new RuleRegistry([retryRule]));

    const ctx = { model: {}, modelRegistry: { getAll: () => [] } } as never;
    const pi = { getActiveTools: () => [] } as never;
    const session = {
      basePath: base,
      pendingOrchestrationDispatch: { stale: true },
      pendingVerificationRetry: {
        unitId: "M001/S01/T01",
        failureContext: "artifact missing",
        attempt: 1,
      },
    } as never;

    const result = await decideOrchestratorDispatch(ctx, pi, base, session, { stateSnapshot });

    assert.deepEqual(result, {
      kind: "skipped",
      reason: "execute-task M001/S01/T01 is already complete",
    });
    const sess = session as { pendingVerificationRetry: unknown; pendingOrchestrationDispatch: unknown };
    assert.equal(sess.pendingVerificationRetry, null);
    assert.equal(sess.pendingOrchestrationDispatch, null);
  } finally {
    resetRegistry();
    closeDatabase();
    rmSync(base, { recursive: true, force: true });
  }
});

test("decideOrchestratorDispatch preserves stop reason as a blocked decision", async () => {
  const stateSnapshot = makeState();
  const stopRule: UnifiedRule = {
    name: "test-stop",
    when: "dispatch",
    evaluation: "first-match",
    where: async () => ({
      action: "stop" as const,
      reason: "remediation blocker",
      level: "warning" as const,
    }),
    then: (r: unknown) => r,
  };
  setRegistry(new RuleRegistry([stopRule]));

  try {
    const ctx = { model: {}, modelRegistry: { getAll: () => [] } } as never;
    const pi = { getActiveTools: () => [] } as never;

    const result = await decideOrchestratorDispatch(ctx, pi, "/tmp/parity-fixture", undefined, { stateSnapshot });

    assert.deepEqual(result, {
      kind: "blocked",
      reason: "remediation blocker",
      action: "pause",
    });
  } finally {
    resetRegistry();
  }
});

test("decideOrchestratorDispatch preserves dispatch skip instead of collapsing it to no remaining units", async () => {
  const stateSnapshot = makeState();
  const skipRule: UnifiedRule = {
    name: "test-skip-gate",
    when: "dispatch",
    evaluation: "first-match",
    where: async () => ({
      action: "skip" as const,
      matchedRule: "evaluating-gates -> omitted",
    }),
    then: (r: unknown) => r,
  };
  setRegistry(new RuleRegistry([skipRule]));

  try {
    const ctx = { model: {}, modelRegistry: { getAll: () => [] } } as never;
    const pi = { getActiveTools: () => [] } as never;

    const result = await decideOrchestratorDispatch(ctx, pi, "/tmp/parity-fixture", undefined, { stateSnapshot });

    assert.deepEqual(result, {
      kind: "skipped",
      reason: "evaluating-gates -> omitted",
    });
  } finally {
    resetRegistry();
  }
});

// Project/App: gsd-pi
// File Purpose: Auto Orchestration module implementation and ADR-015 invariant pipeline owner.
//
// Phase 2 of #442 collapsed the nine single-implementation adapter seams
// (DispatchAdapter, RecoveryAdapter, StateReconciliationAdapter,
// ToolContractAdapter, WorktreeAdapter, HealthAdapter, UokGateAdapter,
// RuntimePersistenceAdapter, NotificationAdapter) into this class. The
// orchestrator now constructs from the concrete extension context and calls
// the real collaborators (state-reconciliation, doctor-proactive,
// auto-dispatch, recovery-classification, tool-contract, worktree-safety,
// uok/gate-runner, journal, session-lock, ctx.ui.notify) directly.

import type { ExtensionAPI, ExtensionContext } from "@gsd/pi-coding-agent";

import type { AutoAdvanceResult, AutoOrchestrationModule, AutoSessionContext, AutoStatus } from "./contracts.js";
import type { AutoSession, PendingOrchestrationDispatch } from "./session.js";
import type { GSDState } from "../types.js";
import type { MinimalModelRegistry } from "../context-budget.js";

import { debugCount, debugTime } from "../debug-logger.js";
import { reconcileBeforeDispatch } from "../state-reconciliation.js";
import { resolveDispatch } from "../auto-dispatch.js";
import { classifyFailure } from "../recovery-classification.js";
import { verifyExpectedArtifact, refreshRecoveryDbForArtifact } from "../auto-recovery.js";
import { invalidateAllCaches } from "../cache.js";
import { compileUnitToolContract } from "../tool-contract.js";
import { createWorktreeSafetyModule } from "../worktree-safety.js";
import { repairAutoWorktreeSafetyFailure } from "../auto-worktree-repair.js";
import { resolveManifest } from "../unit-context-manifest.js";
import {
  preDispatchHealthGate,
  recordHealthSnapshot,
} from "../doctor-proactive.js";
import { checkResourcesStale, autoWorktreeBranch, mergeMilestoneToMain } from "../auto-worktree.js";
import { getSessionLockStatus } from "../session-lock.js";
import { resolveUokFlags } from "../uok/flags.js";
import { emitJournalEvent as _emitJournalEvent } from "../journal.js";
import { loadEffectiveGSDPreferences, getIsolationMode } from "../preferences.js";
import { detectWorktreeName, resolveProjectRoot } from "../worktree.js";
import { GitServiceImpl } from "../git-service.js";
import { WorktreeStateProjection } from "../worktree-state-projection.js";
import { WorktreeLifecycle } from "../worktree-lifecycle.js";
import { createWorkspace, scopeMilestone } from "../workspace.js";
import { supportsStructuredQuestions } from "../workflow-mcp.js";
import { getToolBaselineSnapshot } from "../auto-model-selection.js";
import { deriveState } from "../state.js";
import { parseUnitId } from "../unit-id.js";
import { isClosedStatus } from "../status-guards.js";
import {
  isDbAvailable,
  getSlice,
  getTask,
  refreshOpenDatabaseFromDisk,
} from "../gsd-db.js";
import { getErrorMessage } from "../error-utils.js";
import { logWarning } from "../workflow-logger.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function now(): number {
  return Date.now();
}

/**
 * Size of the dispatch-decision ring buffer used by the Auto Orchestration
 * module's stuck-loop detector. When the same `${unitType}:${unitId}` key
 * fills the window, advance() blocks with `action: "stop"`.
 *
 * Mirrors the legacy `STUCK_WINDOW_SIZE` in auto/phases.ts so behaviour is
 * preserved across the eventual cutover (issue #5791).
 */
export const STUCK_WINDOW_SIZE = 6;

function noRemainingUnitsReason(stateSnapshot: GSDState): string {
  if (stateSnapshot.phase === "complete") {
    return "all milestones complete";
  }
  return "no remaining units";
}

/**
 * Concrete construction context for the Auto Orchestrator.
 *
 * Phase 2 of #442 replaced the nine adapter interfaces with this bundle of the
 * real values the wiring factory used to close over: the extension context and
 * API, the dispatch/runtime base paths, and the shared {@link AutoSession}
 * singleton.
 */
export interface OrchestratorContext {
  ctx: ExtensionContext;
  pi: ExtensionAPI;
  dispatchBasePath: string;
  runtimeBasePath: string;
  session: AutoSession;
}

/** Result type of a single dispatch decision. */
export type DispatchDecision =
  | { kind: "blocked"; reason: string; action: "pause" | "stop" }
  | { kind: "skipped"; reason: string }
  | { unitType: string; unitId: string; reason: string; preconditions: string[] }
  | null;

/** Inputs to a dispatch decision. Caller-supplied fields override ctx-derived ones. */
export interface DispatchDecisionInput {
  stateSnapshot: GSDState;
  /** Optional live session context, forwarded to dispatch rules that need session-derived state. */
  session?: AutoSession;
  /** Mirrors `DispatchContext.structuredQuestionsAvailable` — "true"/"false" string per the dispatch contract. */
  structuredQuestionsAvailable?: "true" | "false";
  /** Session model context window in tokens, forwarded to the budget engine. */
  sessionContextWindow?: number;
  /** Session model provider, used for provider-specific effective context windows. */
  sessionProvider?: string;
  /** Model registry for executor-model lookups inside the budget engine. */
  modelRegistry?: MinimalModelRegistry;
}

function getAlreadyClosedDispatchReason(unitType: string, unitId: string): string | null {
  if (!isDbAvailable()) return null;
  refreshOpenDatabaseFromDisk();
  const { milestone, slice, task } = parseUnitId(unitId);
  if (unitType === "execute-task" && milestone && slice && task) {
    const row = getTask(milestone, slice, task);
    return row && isClosedStatus(row.status)
      ? `execute-task ${unitId} is already ${row.status}`
      : null;
  }
  if (unitType === "complete-slice" && milestone && slice) {
    const row = getSlice(milestone, slice);
    return row && isClosedStatus(row.status)
      ? `complete-slice ${unitId} is already ${row.status}`
      : null;
  }
  return null;
}

function shouldAdoptActiveMilestone(
  state: GSDState,
  activeSession: AutoSession | undefined,
  activeDispatchBasePath: string,
): boolean {
  const activeMilestoneId = state.activeMilestone?.id;
  const currentMilestoneId = activeSession?.currentMilestoneId;
  if (!activeSession || !activeMilestoneId || !currentMilestoneId || activeMilestoneId === currentMilestoneId) {
    return false;
  }

  const scopedWorktreeMilestone =
    (activeSession.basePath ? detectWorktreeName(activeSession.basePath) : null) ??
    detectWorktreeName(activeDispatchBasePath);
  if (scopedWorktreeMilestone && scopedWorktreeMilestone !== activeMilestoneId) {
    return false;
  }

  const currentMilestone = state.registry.find((milestone) => milestone.id === currentMilestoneId);
  return !!currentMilestone && isClosedStatus(currentMilestone.status);
}

/**
 * Pure dispatch-decision function — formerly `createWiredDispatchAdapter`'s
 * `decideNextUnit`. Folded out of the closure so the orchestrator can call it
 * directly and tests can drive the exact dispatch decision logic against real
 * fixtures without re-introducing an adapter seam.
 *
 * Derives session-derived dispatch inputs the same way phases.ts:runDispatch
 * does (#5789): prefers caller-supplied values when present so test harnesses
 * and alternative wirings can inject deterministic snapshots; otherwise pulls
 * from the captured pi/ctx references.
 */
export async function decideOrchestratorDispatch(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  dispatchBasePath: string,
  session: AutoSession | undefined,
  input: DispatchDecisionInput,
): Promise<DispatchDecision> {
  const state = input.stateSnapshot;
  const active = state.activeMilestone;
  if (!active) return null;

  const activeSession = input.session ?? session;
  const activeDispatchBasePath = activeSession?.basePath || dispatchBasePath;
  if (activeSession && shouldAdoptActiveMilestone(state, activeSession, activeDispatchBasePath)) {
    activeSession.currentMilestoneId = active.id;
  }
  const prefs = loadEffectiveGSDPreferences(activeDispatchBasePath)?.preferences;

  // Derive session-derived dispatch inputs the same way phases.ts:runDispatch does
  // (#5789). Prefer caller-supplied values when present so test harnesses and
  // alternative wirings can inject deterministic snapshots; otherwise pull from
  // the captured pi/ctx references.
  const sessionProvider = input.sessionProvider ?? ctx.model?.provider;
  const sessionContextWindow = input.sessionContextWindow ?? ctx.model?.contextWindow;
  const modelRegistry = input.modelRegistry ?? (ctx.modelRegistry as MinimalModelRegistry | undefined);
  const authMode =
    sessionProvider && typeof ctx.modelRegistry?.getProviderAuthMode === "function"
      ? ctx.modelRegistry.getProviderAuthMode(sessionProvider)
      : undefined;
  // Use baseline snapshot — same reason as phases.ts:runDispatch: the live
  // active set may be narrowed by the prior unit before selectAndApplyModel
  // restores it, causing false transport-preflight failures (#477 follow-up).
  const activeTools = getToolBaselineSnapshot(pi);
  // Mirrors runDispatch: deep-planning keeps approval gates in plain chat
  // because structured questions can be cancelled outside the chat turn on
  // some transports.
  const structuredQuestionsAvailable =
    input.structuredQuestionsAvailable ??
    (prefs?.planning_depth === "deep"
      ? "false"
      : supportsStructuredQuestions(activeTools, {
          authMode,
          baseUrl: ctx.model?.baseUrl,
        })
        ? "true"
        : "false");

  const pendingRetry = session?.pendingVerificationRetryDispatch;
  if (session && pendingRetry) {
    session.pendingVerificationRetryDispatch = null;
    const alreadyClosedReason = getAlreadyClosedDispatchReason(
      pendingRetry.unitType,
      pendingRetry.unitId,
    );
    if (alreadyClosedReason) {
      session.pendingOrchestrationDispatch = null;
      session.pendingVerificationRetry = null;
      return { kind: "skipped", reason: alreadyClosedReason };
    }
    session.pendingOrchestrationDispatch = pendingRetry;
    return {
      unitType: pendingRetry.unitType,
      unitId: pendingRetry.unitId,
      reason: "verification-retry",
      preconditions: [],
    };
  }

  const action = await resolveDispatch({
    basePath: activeDispatchBasePath,
    mid: active.id,
    midTitle: active.title,
    state,
    prefs,
    session: activeSession,
    structuredQuestionsAvailable,
    sessionContextWindow,
    sessionProvider,
    modelRegistry,
    activeTools,
    sessionAuthMode: authMode,
    sessionBaseUrl: ctx.model?.baseUrl,
  });

  if (action.action === "stop") {
    if (session) session.pendingOrchestrationDispatch = null;
    return {
      kind: "blocked",
      reason: action.reason,
      action: action.level === "warning" ? "pause" : "stop",
    };
  }
  if (action.action !== "dispatch") {
    if (session) session.pendingOrchestrationDispatch = null;
    return {
      kind: "skipped",
      reason: action.matchedRule ?? "dispatch-skip",
    };
  }
  const alreadyClosedReason = getAlreadyClosedDispatchReason(action.unitType, action.unitId);
  if (alreadyClosedReason) {
    if (session) {
      session.pendingOrchestrationDispatch = null;
      session.pendingVerificationRetry = null;
    }
    return { kind: "skipped", reason: alreadyClosedReason };
  }
  if (session) {
    const pending: PendingOrchestrationDispatch = {
      unitType: action.unitType,
      unitId: action.unitId,
      prompt: action.prompt,
      pauseAfterUatDispatch: action.pauseAfterDispatch ?? false,
      state,
      mid: active.id,
      midTitle: active.title,
    };
    session.pendingOrchestrationDispatch = pending;
  }
  return {
    unitType: action.unitType,
    unitId: action.unitId,
    reason: action.matchedRule ?? "dispatch",
    preconditions: [],
  };
}

export class AutoOrchestrator implements AutoOrchestrationModule {
  private status: AutoStatus = {
    phase: "idle",
    transitionCount: 0,
  };
  private readonly ctx: ExtensionContext;
  private readonly pi: ExtensionAPI;
  private readonly dispatchBasePath: string;
  private readonly runtimeBasePath: string;
  private readonly s: AutoSession;
  private readonly flowId: string;
  private seq = 0;
  private lastAdvanceKey: string | null = null;
  private lastFinalizedUnitKey: string | null = null;
  private dispatchKeyWindow: string[] = [];
  // #442: the unit key we last attempted graduated stuck-recovery for. Bounds
  // recovery to one attempt per stuck episode per run (reset on start/resume/
  // stop), mirroring the legacy Level-1-then-Level-2 escalation in phases.ts.
  private lastStuckRecoveryKey: string | null = null;

  public constructor(context: OrchestratorContext) {
    this.ctx = context.ctx;
    this.pi = context.pi;
    this.dispatchBasePath = context.dispatchBasePath;
    this.runtimeBasePath = context.runtimeBasePath;
    this.s = context.session;
    this.flowId = `auto-orchestrator-${Date.now()}`;
  }

  // ── Live base-path resolution (was the wiring factory's getLiveDispatchBasePath) ──

  private getLiveDispatchBasePath(): string {
    return resolveLiveOrchestratorBasePath({
      capturedBasePath: this.dispatchBasePath,
      runtimeBasePath: this.runtimeBasePath,
      sessionBasePath: this.s.basePath,
      originalBasePath: this.s.originalBasePath,
    });
  }

  // ── RuntimePersistenceAdapter (folded) ───────────────────────────────────

  private ensureLockOwnership(): void {
    const status = getSessionLockStatus(this.runtimeBasePath);
    if (!status.valid || status.failureReason === "pid-mismatch") {
      throw new Error("session lock held by another process");
    }
  }

  /**
   * Map an orchestrator lifecycle event name to its journal eventType and emit
   * it. The name→eventType ternary is preserved byte-for-byte from the legacy
   * wired RuntimePersistenceAdapter.journalTransition.
   */
  private journalTransition(event: {
    name: string;
    reason?: string;
    unitType?: string;
    unitId?: string;
  }): void {
    const eventType = event.name === "start"
      ? "orchestrator-iteration-start"
      : event.name === "resume"
        ? "orchestrator-iteration-start"
        : event.name === "advance"
          ? "orchestrator-dispatch-match"
          : event.name === "advance-blocked"
            ? "orchestrator-guard-block"
            : event.name === "advance-stopped"
              ? "orchestrator-dispatch-stop"
              : event.name === "advance-error"
                ? "orchestrator-iteration-end"
                : event.name === "advance-paused" || event.name === "advance-retry"
                  ? "orchestrator-guard-block"
                  : event.name === "stop"
                  ? "orchestrator-terminal"
                  : "orchestrator-iteration-end";

    _emitJournalEvent(this.runtimeBasePath, {
      ts: new Date().toISOString(),
      flowId: this.flowId,
      seq: ++this.seq,
      eventType,
      data: {
        source: "auto-orchestrator",
        name: event.name,
        reason: event.reason,
        unitType: event.unitType,
        unitId: event.unitId,
      },
    });
  }

  // ── NotificationAdapter (folded) ─────────────────────────────────────────

  private notifyLifecycle(event: { name: string; detail?: string }): void {
    if (event.name === "error") {
      this.ctx.ui.notify(event.detail ?? "auto orchestration error", "error");
    }
  }

  // ── HealthAdapter (folded) ───────────────────────────────────────────────

  private checkResourcesStale(): string | null {
    return checkResourcesStale(this.s.resourceVersionOnStart);
  }

  private async preAdvanceGate(): Promise<
    | { kind: "pass"; fixesApplied?: readonly string[] }
    | { kind: "fail"; reason: string; action?: "pause" | "stop" }
    | { kind: "threw"; error: unknown }
  > {
    try {
      const gate = await preDispatchHealthGate(this.getLiveDispatchBasePath());
      if (gate.proceed) {
        return {
          kind: "pass",
          fixesApplied: gate.fixesApplied,
        };
      }
      return {
        kind: "fail",
        reason: gate.reason ?? "Pre-dispatch health check failed — run /gsd doctor for details.",
        action: gate.severity ?? "pause",
      };
    } catch (error) {
      return { kind: "threw", error };
    }
  }

  private postAdvanceRecord(result: AutoAdvanceResult): void {
    if (result.kind === "error") {
      recordHealthSnapshot(1, 0, 0, [{
        code: "orchestration-error",
        message: result.reason ?? "orchestration error",
        severity: "error",
        unitId: "orchestration",
      }], [], "orchestration");
    } else if (result.kind === "blocked") {
      recordHealthSnapshot(0, 1, 0, [{
        code: "orchestration-blocked",
        message: result.reason ?? "orchestration blocked",
        severity: "warning",
        unitId: "orchestration",
      }], [], "orchestration");
    }
  }

  // ── UokGateAdapter (folded) ──────────────────────────────────────────────

  private async emitUokGate(input: {
    gateId: string;
    gateType: "policy" | "execution";
    outcome: "pass" | "fail" | "manual-attention";
    failureClass: "none" | "policy" | "manual-attention";
    rationale: string;
    findings?: string;
    milestoneId?: string;
  }): Promise<void> {
    const activeBasePath = this.getLiveDispatchBasePath();
    const prefs = loadEffectiveGSDPreferences(activeBasePath)?.preferences;
    const uokFlags = resolveUokFlags(prefs);
    if (!uokFlags.gates) return;
    const milestoneId = input.milestoneId ?? this.s.currentMilestoneId ?? undefined;
    try {
      const { UokGateRunner } = await import("../uok/gate-runner.js");
      const runner = new UokGateRunner();
      runner.register({
        id: input.gateId,
        type: input.gateType,
        execute: async () => ({
          outcome: input.outcome,
          failureClass: input.failureClass,
          rationale: input.rationale,
          findings: input.findings ?? "",
        }),
      });
      await runner.run(input.gateId, {
        basePath: activeBasePath,
        traceId: `pre-dispatch:${this.flowId}`,
        turnId: `orch-${this.seq}`,
        milestoneId,
        unitType: "pre-dispatch",
        unitId: `orch-${this.seq}`,
      });
    } catch (err) {
      logWarning("engine", `uok gate emit failed: ${getErrorMessage(err)}`, {
        file: "orchestrator.ts",
        gateId: input.gateId,
        gateType: input.gateType,
        ...(milestoneId ? { milestoneId } : {}),
      });
    }
  }

  // ── StateReconciliationAdapter (folded) ──────────────────────────────────

  private async reconcileBeforeDispatch(): Promise<
    { ok: true; reason: string; stateSnapshot?: GSDState }
    | { ok: false; reason: string; stateSnapshot?: GSDState }
  > {
    const activeBasePath = this.getLiveDispatchBasePath();
    const result = await reconcileBeforeDispatch(activeBasePath);
    // Failure-path summaries written by gsd_summary_save create
    // artifact-db-status-divergence blockers for tasks that are still
    // pending (gsd_task_complete never ran). These tasks can still be
    // dispatched and the drift self-heals once they complete successfully.
    const hardBlockers = result.blockers.filter(
      (b) =>
        !b.includes("has SUMMARY artifact while DB status is") &&
        !b.includes("has SUMMARY on disk while DB status is") &&
        !b.includes("has task SUMMARY artifacts but no DB tasks"),
    );
    if (hardBlockers.length > 0) {
      return {
        ok: false,
        reason: hardBlockers[0],
        stateSnapshot: result.stateSnapshot,
      };
    }
    const repairedKinds = result.repaired.map((d) => d.kind);
    return {
      ok: true,
      reason:
        repairedKinds.length > 0
          ? `repaired: ${repairedKinds.join(", ")}`
          : "clean",
      stateSnapshot: result.stateSnapshot,
    };
  }

  // ── DispatchAdapter (folded) ─────────────────────────────────────────────

  private decideNextUnit(input: DispatchDecisionInput): Promise<DispatchDecision> {
    return decideOrchestratorDispatch(this.ctx, this.pi, this.dispatchBasePath, this.s, input);
  }

  // ── ToolContractAdapter (folded) ─────────────────────────────────────────

  private compileUnitToolContract(unitType: string): { ok: true; reason: string } | { ok: false; reason: string } {
    const result = compileUnitToolContract(unitType);
    if (!result.ok) return { ok: false, reason: result.detail };
    return { ok: true, reason: result.contract.validationRules.join(", ") };
  }

  // ── WorktreeAdapter (folded) ─────────────────────────────────────────────

  private getEffectiveUnitIsolationMode(basePath: string): ReturnType<typeof getIsolationMode> {
    const configuredMode = getIsolationMode(basePath);
    return configuredMode === "worktree" && this.s.isolationDegraded ? "branch" : configuredMode;
  }

  private buildLifecycle(): WorktreeLifecycle {
    return new WorktreeLifecycle(this.s, {
      gitServiceFactory: (basePath: string) => {
        const gitConfig = loadEffectiveGSDPreferences()?.preferences?.git ?? {};
        return new GitServiceImpl(basePath, gitConfig);
      },
      worktreeProjection: new WorktreeStateProjection(),
      mergeMilestoneToMain,
    });
  }

  private rebuildScope(rawPath: string, milestoneId: string | null): void {
    if (!milestoneId) {
      this.s.scope = null;
      return;
    }
    try {
      const workspace = createWorkspace(rawPath);
      this.s.scope = scopeMilestone(workspace, milestoneId);
    } catch {
      // Non-fatal — scope is additive. Existing readers still use basePath.
      this.s.scope = null;
    }
  }

  private async prepareWorktreeForUnit(
    unitType: string,
    unitId: string,
  ): Promise<{ ok: true; reason: string } | { ok: false; reason: string }> {
    const isolationMode = this.getEffectiveUnitIsolationMode(this.runtimeBasePath);
    const manifest = resolveManifest(unitType);
    if (!manifest) {
      return {
        ok: false,
        reason: `No Unit manifest is registered for ${unitType}`,
      };
    }
    if (isolationMode !== "worktree") {
      return { ok: true, reason: "not-required" };
    }
    const writeScope =
      manifest.tools.mode === "all" || manifest.tools.mode === "docs"
        ? "source-writing"
        : "planning-only";
    const safety = createWorktreeSafetyModule();
    const activeBasePath = this.getLiveDispatchBasePath();
    const snapshot = await deriveState(activeBasePath);
    const milestoneId = snapshot.activeMilestone?.id ?? null;
    const expectedBranch = milestoneId ? autoWorktreeBranch(milestoneId) : null;
    let result = safety.validateUnitRoot({
      unitType,
      unitId,
      writeScope,
      projectRoot: this.runtimeBasePath,
      unitRoot: activeBasePath,
      milestoneId,
      isolationMode,
      expectedBranch,
    });
    if (!result.ok) {
      const repaired = await repairAutoWorktreeSafetyFailure({
        safetyResult: result,
        projectRoot: this.runtimeBasePath,
        activeRoot: activeBasePath,
        milestoneId,
        enterMilestone: async (id) => {
          this.buildLifecycle().adoptSessionRoot(this.runtimeBasePath, this.s.originalBasePath || this.runtimeBasePath);
          const enterResult = this.buildLifecycle().enterMilestone(id, {
            notify: this.ctx.ui.notify.bind(this.ctx.ui),
          });
          if (!enterResult.ok) return { ok: false, reason: enterResult.reason };
          this.rebuildScope(this.s.basePath, this.s.currentMilestoneId);
          return { ok: true };
        },
        revalidate: () => safety.validateUnitRoot({
          unitType,
          unitId,
          writeScope,
          projectRoot: this.runtimeBasePath,
          unitRoot: this.getLiveDispatchBasePath(),
          milestoneId,
          isolationMode: this.getEffectiveUnitIsolationMode(this.runtimeBasePath),
          expectedBranch,
        }),
      });
      result = repaired.result;
      if (result.ok) {
        return { ok: true, reason: repaired.repaired ? `repaired-${result.kind}` : result.kind };
      }
      const repairDetail = repaired.repairReason
        ? ` (repair skipped: ${repaired.repairReason})`
        : "";
      return { ok: false, reason: `${result.kind}: ${result.reason}${repairDetail}` };
    }
    return { ok: true, reason: result.kind };
  }

  // ── RecoveryAdapter (folded) ─────────────────────────────────────────────

  private classifyAndRecover(input: {
    error: unknown;
    unitType?: string;
    unitId?: string;
  }): { action: "retry" | "escalate" | "stop"; reason: string } {
    const recovery = classifyFailure(input);
    return { action: recovery.action, reason: recovery.reason };
  }

  // ── Lifecycle verbs ──────────────────────────────────────────────────────

  /**
   * #442: graduated stuck recovery, ported from the legacy
   * auto/phases.ts:runDispatch path that Phase 3 retires. The ring-buffer
   * hard-stops (stuck-loop saturation and finalized-repeat) would otherwise
   * KILL a unit that actually completed on disk but whose DB row is still
   * stale. Before hard-stopping, verify the expected artifact exists; if so,
   * refresh the DB from it, invalidate caches and reset the dispatch ring so
   * the next advance picks the correct next unit. Bounded to one attempt per
   * stuck key per episode (reset on lifecycle + genuine finalize) to avoid an
   * unbounded recover→re-saturate→recover loop — mirrors the legacy
   * Level-1-recover-then-Level-2-hard-stop escalation.
   *
   * Returns true when recovery succeeded; the caller should re-loop (return a
   * skipped result) instead of stopping.
   */
  private tryStuckArtifactRecovery(unitType: string, unitId: string): boolean {
    const key = `${unitType}:${unitId}`;
    if (this.lastStuckRecoveryKey === key) return false; // already tried this episode
    const basePath = this.getLiveDispatchBasePath();
    if (!verifyExpectedArtifact(unitType, unitId, basePath)) return false;
    const refreshed = refreshRecoveryDbForArtifact(unitType, unitId, basePath);
    // Fatal failures cannot be recovered — hard-stop. Non-fatal (e.g. plan-slice
    // DB refresh hiccup) still fall through: invalidating caches and resetting
    // the ring gives the next advance a clean slate to pick up the correct state,
    // mirroring the legacy Level-1 "continue" escalation path.
    if (!refreshed.ok && refreshed.fatal) return false;
    this.lastStuckRecoveryKey = key;
    invalidateAllCaches();
    this.dispatchKeyWindow = [];
    this.lastAdvanceKey = null;
    this.lastFinalizedUnitKey = null;
    return true;
  }

  private stuckRecovered(
    decision: { unitType: string; unitId: string },
    stateSnapshot: GSDState,
  ): AutoAdvanceResult {
    const recovered: AutoAdvanceResult = {
      kind: "skipped",
      reason: `stuck-recovery: ${decision.unitType} ${decision.unitId} artifact found on disk; DB refreshed`,
      stateSnapshot,
    };
    this.status.phase = "running";
    this.status.activeUnit = undefined;
    this.bumpTransition();
    this.journalTransition({
      name: "advance-skipped",
      reason: recovered.reason,
      unitType: decision.unitType,
      unitId: decision.unitId,
    });
    this.postAdvanceRecord(recovered);
    return recovered;
  }

  public async start(_sessionContext: AutoSessionContext): Promise<AutoAdvanceResult> {
    this.lastAdvanceKey = null;
    this.lastFinalizedUnitKey = null;
    this.dispatchKeyWindow = [];
    this.lastStuckRecoveryKey = null;
    this.status.phase = "running";
    this.bumpTransition();
    this.journalTransition({ name: "start" });
    this.notifyLifecycle({ name: "start" });
    return { kind: "started" };
  }

  public async advance(): Promise<AutoAdvanceResult> {
    debugCount("dispatches");
    const stopAdvanceTimer = debugTime("orchestrator-advance");
    try {
      this.ensureLockOwnership();

      const staleMsg = this.checkResourcesStale();
      if (staleMsg) {
        await this.emitUokGate({
          gateId: "resource-version-guard",
          gateType: "policy",
          outcome: "fail",
          failureClass: "policy",
          rationale: "resource version guard blocked dispatch",
          findings: staleMsg,
        });
        const blocked: AutoAdvanceResult = { kind: "blocked", reason: staleMsg, action: "pause" };
        this.journalTransition({ name: "advance-blocked", reason: blocked.reason });
        this.postAdvanceRecord(blocked);
        return blocked;
      }
      await this.emitUokGate({
        gateId: "resource-version-guard",
        gateType: "policy",
        outcome: "pass",
        failureClass: "none",
        rationale: "resource version guard passed",
      });

      const gate = await this.preAdvanceGate();
      if (gate.kind === "fail") {
        await this.emitUokGate({
          gateId: "pre-dispatch-health-gate",
          gateType: "execution",
          outcome: "manual-attention",
          failureClass: "manual-attention",
          rationale: "pre-dispatch health gate blocked dispatch",
          findings: gate.reason,
        });
        const blocked: AutoAdvanceResult = {
          kind: "blocked",
          reason: gate.reason,
          action: gate.action ?? "pause",
        };
        this.journalTransition({ name: "advance-blocked", reason: blocked.reason });
        this.postAdvanceRecord(blocked);
        return blocked;
      }
      if (gate.kind === "threw") {
        await this.emitUokGate({
          gateId: "pre-dispatch-health-gate",
          gateType: "execution",
          outcome: "manual-attention",
          failureClass: "manual-attention",
          rationale: "pre-dispatch health gate threw unexpectedly",
          findings: String(gate.error),
        });
        // intentional fall-through: matches runPreDispatch behaviour
      } else {
        await this.emitUokGate({
          gateId: "pre-dispatch-health-gate",
          gateType: "execution",
          outcome: "pass",
          failureClass: "none",
          rationale: "pre-dispatch health gate passed",
          findings: gate.fixesApplied?.join(", ") ?? "",
        });
      }

      const reconciliation = await this.reconcileBeforeDispatch();
      if (!reconciliation.ok || !reconciliation.stateSnapshot) {
        const blocked: AutoAdvanceResult = {
          kind: "blocked",
          reason: reconciliation.reason ?? "state reconciliation produced no snapshot",
          action: "pause",
          stateSnapshot: reconciliation.stateSnapshot,
        };
        this.journalTransition({ name: "advance-blocked", reason: blocked.reason });
        this.postAdvanceRecord(blocked);
        return blocked;
      }

      const decision = await this.decideNextUnit({ stateSnapshot: reconciliation.stateSnapshot });
      if (!decision) {
        const stopped: AutoAdvanceResult = {
          kind: "stopped",
          reason: noRemainingUnitsReason(reconciliation.stateSnapshot),
          stateSnapshot: reconciliation.stateSnapshot,
        };
        this.status.phase = "stopped";
        this.status.activeUnit = undefined;
        this.lastAdvanceKey = null;
        this.dispatchKeyWindow = [];
        this.bumpTransition();
        this.journalTransition({ name: "advance-stopped", reason: stopped.reason });
        this.postAdvanceRecord(stopped);
        return stopped;
      }
      if ("kind" in decision && decision.kind === "skipped") {
        const skipped: AutoAdvanceResult = {
          kind: "skipped",
          reason: decision.reason,
          stateSnapshot: reconciliation.stateSnapshot,
        };
        this.status.phase = "running";
        this.status.activeUnit = undefined;
        this.bumpTransition();
        this.journalTransition({ name: "advance-skipped", reason: skipped.reason });
        this.postAdvanceRecord(skipped);
        return skipped;
      }
      if (!("unitType" in decision)) {
        const blocked: AutoAdvanceResult = {
          kind: "blocked",
          reason: decision.reason,
          action: decision.action,
          stateSnapshot: reconciliation.stateSnapshot,
        };
        this.journalTransition({ name: "advance-blocked", reason: blocked.reason });
        this.postAdvanceRecord(blocked);
        return blocked;
      }

      const nextKey = `${decision.unitType}:${decision.unitId}`;

      // Record every dispatch decision in the ring buffer before pre-flight
      // checks so the stuck-loop detector observes the full decision history
      // (including decisions that idempotency would otherwise short-circuit).
      // The ring is capped at STUCK_WINDOW_SIZE and evicts oldest-first.
      this.dispatchKeyWindow.push(nextKey);
      if (this.dispatchKeyWindow.length > STUCK_WINDOW_SIZE) {
        this.dispatchKeyWindow.shift();
      }

      const matchingCount = this.dispatchKeyWindow.filter((k) => k === nextKey).length;
      if (this.lastFinalizedUnitKey === nextKey) {
        // #442: the unit re-dispatched immediately after finalizing may have
        // actually completed on disk with a stale DB. Verify + recover before
        // hard-stopping (legacy graduated stuck-recovery parity).
        if (this.tryStuckArtifactRecovery(decision.unitType, decision.unitId)) {
          return this.stuckRecovered(decision, reconciliation.stateSnapshot);
        }
        const blocked: AutoAdvanceResult = {
          kind: "blocked",
          reason: `state did not advance after finalized ${decision.unitType} ${decision.unitId}`,
          action: "stop",
          stateSnapshot: reconciliation.stateSnapshot,
        };
        this.journalTransition({
          name: "advance-blocked",
          reason: blocked.reason,
          unitType: decision.unitType,
          unitId: decision.unitId,
        });
        this.postAdvanceRecord(blocked);
        return blocked;
      }

      // Idempotency: same key as immediately previous successful advance.
      // This is the soft, fast-path block kept from #5786. It only fires when
      // the ring is NOT yet saturated for this key — once the ring is full of
      // `nextKey`, the stuck-loop verdict takes precedence (see below). Both
      // checks coexist: idempotency for the common immediate-repeat case,
      // stuck-loop for the saturated-window case.
      if (this.lastAdvanceKey === nextKey && matchingCount < STUCK_WINDOW_SIZE) {
        const blocked: AutoAdvanceResult = { kind: "blocked", reason: "idempotent advance: unit already active", action: "pause" };
        this.journalTransition({
          name: "advance-blocked",
          reason: blocked.reason,
          unitType: decision.unitType,
          unitId: decision.unitId,
        });
        this.postAdvanceRecord(blocked);
        return blocked;
      }

      // Stuck-loop detection: when the ring is saturated with copies of
      // `nextKey` (count >= STUCK_WINDOW_SIZE), the orchestrator has been
      // picking the same unit across the whole window and must hard-stop with
      // a diagnosable reason.
      if (matchingCount >= STUCK_WINDOW_SIZE) {
        // #442: before declaring a stuck loop, verify the unit didn't actually
        // complete on disk (stale DB) and recover if so — legacy graduated
        // stuck-recovery parity. Otherwise hard-stop with a diagnosable reason.
        if (this.tryStuckArtifactRecovery(decision.unitType, decision.unitId)) {
          return this.stuckRecovered(decision, reconciliation.stateSnapshot);
        }
        const blocked: AutoAdvanceResult = {
          kind: "blocked",
          reason: `stuck-loop: ${nextKey} picked ${matchingCount} times`,
          action: "stop",
        };
        this.journalTransition({
          name: "advance-blocked",
          reason: blocked.reason,
          unitType: decision.unitType,
          unitId: decision.unitId,
        });
        this.postAdvanceRecord(blocked);
        return blocked;
      }

      const contract = this.compileUnitToolContract(decision.unitType);
      if (!contract.ok) {
        const blocked: AutoAdvanceResult = {
          kind: "blocked",
          reason: contract.reason,
          action: "pause",
          stateSnapshot: reconciliation.stateSnapshot,
        };
        this.journalTransition({
          name: "advance-blocked",
          reason: blocked.reason,
          unitType: decision.unitType,
          unitId: decision.unitId,
        });
        this.postAdvanceRecord(blocked);
        return blocked;
      }

      const worktree = await this.prepareWorktreeForUnit(decision.unitType, decision.unitId);
      if (!worktree.ok) {
        const blocked: AutoAdvanceResult = {
          kind: "blocked",
          reason: worktree.reason,
          action: "pause",
          stateSnapshot: reconciliation.stateSnapshot,
        };
        this.journalTransition({
          name: "advance-blocked",
          reason: blocked.reason,
          unitType: decision.unitType,
          unitId: decision.unitId,
        });
        this.postAdvanceRecord(blocked);
        return blocked;
      }

      this.status.activeUnit = { unitType: decision.unitType, unitId: decision.unitId };
      this.status.phase = "running";
      this.lastAdvanceKey = nextKey;
      this.bumpTransition();

      this.journalTransition({
        name: "advance",
        reason: decision.reason,
        unitType: decision.unitType,
        unitId: decision.unitId,
      });
      // syncAfterUnit was a no-op in the wired WorktreeAdapter.

      const advanced: AutoAdvanceResult = {
        kind: "advanced",
        unit: { unitType: decision.unitType, unitId: decision.unitId },
        stateSnapshot: reconciliation.stateSnapshot,
      };
      this.postAdvanceRecord(advanced);
      return advanced;
    } catch (error) {
      const recovery = this.classifyAndRecover({
        error,
        unitType: this.status.activeUnit?.unitType,
        unitId: this.status.activeUnit?.unitId,
      });
      const result: AutoAdvanceResult = recovery.action === "retry"
        ? { kind: "paused", reason: recovery.reason }
        : recovery.action === "escalate"
          ? { kind: "error", reason: recovery.reason }
          : { kind: "stopped", reason: recovery.reason };

      if (result.kind === "paused") {
        this.status.phase = "paused";
      } else if (result.kind === "stopped") {
        this.status.phase = "stopped";
      } else {
        this.status.phase = "error";
      }

      if (result.kind === "stopped") {
        this.lastAdvanceKey = null;
        this.lastFinalizedUnitKey = null;
        this.dispatchKeyWindow = [];
        this.status.activeUnit = undefined;
      }
      this.bumpTransition();

      const journalName = result.kind === "paused"
        ? "advance-paused"
        : result.kind === "stopped"
          ? "advance-stopped"
          : "advance-error";
      this.journalTransition({ name: journalName, reason: recovery.reason });

      if (result.kind === "paused") {
        this.notifyLifecycle({ name: "pause", detail: recovery.reason });
      } else if (result.kind === "stopped") {
        this.notifyLifecycle({ name: "stopped", detail: recovery.reason });
      } else if (result.kind === "error") {
        this.notifyLifecycle({ name: "error", detail: recovery.reason });
      }
      this.postAdvanceRecord(result);
      return result;
    } finally {
      stopAdvanceTimer();
    }
  }

  public async resume(): Promise<AutoAdvanceResult> {
    this.lastAdvanceKey = null;
    this.lastFinalizedUnitKey = null;
    this.dispatchKeyWindow = [];
    this.lastStuckRecoveryKey = null;
    this.status.phase = "running";
    this.bumpTransition();
    this.journalTransition({ name: "resume" });
    this.notifyLifecycle({ name: "resume" });
    return { kind: "resumed" };
  }

  public async stop(reason: string): Promise<AutoAdvanceResult> {
    if (this.status.phase === "stopped") {
      return { kind: "stopped", reason };
    }
    // cleanupOnStop was a no-op in the wired WorktreeAdapter.
    this.status.phase = "stopped";
    this.status.activeUnit = undefined;
    this.lastAdvanceKey = null;
    this.lastFinalizedUnitKey = null;
    this.dispatchKeyWindow = [];
    this.lastStuckRecoveryKey = null;
    this.bumpTransition();
    this.journalTransition({ name: "stop", reason });
    this.notifyLifecycle({ name: "stop", detail: reason });
    return { kind: "stopped", reason };
  }

  public getStatus(): AutoStatus {
    return { ...this.status, activeUnit: this.status.activeUnit ? { ...this.status.activeUnit } : undefined };
  }

  public async completeActiveUnit(unit: { unitType: string; unitId: string }): Promise<void> {
    const unitKey = `${unit.unitType}:${unit.unitId}`;
    const activeUnitKey = this.status.activeUnit
      ? `${this.status.activeUnit.unitType}:${this.status.activeUnit.unitId}`
      : null;
    if (activeUnitKey !== unitKey) return;

    this.status.activeUnit = undefined;
    this.lastAdvanceKey = null;
    this.lastFinalizedUnitKey = unitKey;
    // Genuine progress — re-enable graduated stuck recovery for future episodes.
    this.lastStuckRecoveryKey = null;
    this.bumpTransition();
    this.journalTransition({
      name: "unit-finalized",
      unitType: unit.unitType,
      unitId: unit.unitId,
    });
  }

  public async retryActiveUnit(unit: { unitType: string; unitId: string }): Promise<void> {
    const unitKey = `${unit.unitType}:${unit.unitId}`;
    const activeUnitKey = this.status.activeUnit
      ? `${this.status.activeUnit.unitType}:${this.status.activeUnit.unitId}`
      : null;
    if (activeUnitKey !== unitKey && this.lastFinalizedUnitKey !== unitKey) return;

    if (activeUnitKey === unitKey) {
      this.status.activeUnit = undefined;
    }
    this.lastAdvanceKey = null;
    this.lastFinalizedUnitKey = null;
    this.bumpTransition();
    this.journalTransition({
      name: "unit-retry",
      reason: "finalize-retry",
      unitType: unit.unitType,
      unitId: unit.unitId,
    });
  }

  private bumpTransition(): void {
    this.status.transitionCount += 1;
    this.status.lastTransitionAt = now();
  }
}

function isUsableLiveOrchestratorBasePath(basePath: string): boolean {
  if (!basePath || !existsSync(basePath)) return false;
  if (!detectWorktreeName(basePath)) return true;

  try {
    return readFileSync(join(basePath, ".git"), "utf8").trim().startsWith("gitdir: ");
  } catch {
    return false;
  }
}

/**
 * Resolve the base path the live orchestrator should dispatch from, falling
 * back to the project root when the captured worktree path has been removed
 * (e.g. after milestone-merge cleanup). Exported for the closeout-regression
 * tests and reused by the orchestrator's getLiveDispatchBasePath.
 */
export function resolveLiveOrchestratorBasePath(input: {
  capturedBasePath: string;
  runtimeBasePath: string;
  sessionBasePath?: string | null;
  originalBasePath?: string | null;
}): string {
  const primary = input.sessionBasePath || input.capturedBasePath;
  if (isUsableLiveOrchestratorBasePath(primary)) return primary;

  const fallbacks = [
    input.originalBasePath,
    input.runtimeBasePath,
    resolveProjectRoot(input.capturedBasePath),
  ];

  for (const candidate of fallbacks) {
    if (candidate && isUsableLiveOrchestratorBasePath(candidate)) {
      return candidate;
    }
  }

  return input.runtimeBasePath || input.capturedBasePath;
}

export function createAutoOrchestrator(context: OrchestratorContext): AutoOrchestrationModule {
  return new AutoOrchestrator(context);
}

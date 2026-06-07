// Project/App: gsd-pi
// File Purpose: Auto Orchestration module public contract types.
//
// Phase 2 of #442 collapsed the nine single-implementation adapter interfaces
// (DispatchAdapter, RecoveryAdapter, StateReconciliationAdapter,
// ToolContractAdapter, WorktreeAdapter, HealthAdapter, UokGateAdapter,
// RuntimePersistenceAdapter, NotificationAdapter) and AutoOrchestratorDeps
// into AutoOrchestrator itself (auto/orchestrator.ts). Only the public result
// and lifecycle-interface types remain here.

import type { GSDState } from "../types.js";

export interface AutoSessionContext {
  basePath: string;
  trigger: "guided-flow" | "resume" | "auto-loop" | "manual";
}

export interface UnitRef {
  unitType: string;
  unitId: string;
}

export interface AutoStatus {
  phase: "idle" | "running" | "paused" | "stopped" | "error";
  activeUnit?: UnitRef;
  lastTransitionAt?: number;
  transitionCount: number;
}

export type AutoAdvanceResult =
  | { kind: "started" }
  | { kind: "resumed" }
  | { kind: "advanced"; unit: UnitRef; stateSnapshot: GSDState }
  | { kind: "skipped"; reason: string; stateSnapshot?: GSDState }
  | { kind: "blocked"; reason: string; action: "pause" | "stop"; stateSnapshot?: GSDState }
  | { kind: "stopped"; reason: string; stateSnapshot?: GSDState }
  | { kind: "paused"; reason: string }
  | { kind: "error"; reason: string };

export interface AutoOrchestrationModule {
  start(sessionContext: AutoSessionContext): Promise<AutoAdvanceResult>;
  advance(): Promise<AutoAdvanceResult>;
  completeActiveUnit(unit: UnitRef): Promise<void>;
  retryActiveUnit(unit: UnitRef): Promise<void>;
  resume(): Promise<AutoAdvanceResult>;
  stop(reason: string): Promise<AutoAdvanceResult>;
  getStatus(): AutoStatus;
}

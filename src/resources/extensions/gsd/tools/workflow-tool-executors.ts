// Project/App: gsd-pi
// File Purpose: Adapts shared GSD workflow handlers for MCP executor calls.

import { ensureDbOpen } from "../bootstrap/dynamic-tools.js";
import { sanitizeCompleteMilestoneParams } from "../bootstrap/sanitize-complete-milestone.js";
import { loadWriteGateSnapshot, shouldBlockContextArtifactSaveInSnapshot, shouldBlockRootArtifactSaveInSnapshot } from "../bootstrap/write-gate.js";
import {
  getActiveRequirements,
  insertMilestone,
  getMilestone,
  getSliceStatusSummary,
  getSliceTaskCounts,
  insertGateRun,
  readTransaction,
  saveGateResult,
  upsertQualityGate,
} from "../gsd-db.js";
import { GATE_REGISTRY } from "../gate-registry.js";
import { generateRequirementsMd, saveArtifactToDb } from "../db-writer.js";
import { clearPathCache, resolveGsdPathContract, resolveMilestoneFile, resolveSliceFile } from "../paths.js";
import { saveFile, clearParseCache } from "../files.js";
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { CompleteMilestoneParams } from "./complete-milestone.js";
import { handleCompleteMilestone } from "./complete-milestone.js";
import { handleCompleteTask } from "./complete-task.js";
import type { CompleteSliceParams, EscalationOption } from "../types.js";
import { handleCompleteSlice } from "./complete-slice.js";
import type { PlanMilestoneParams } from "./plan-milestone.js";
import { handlePlanMilestone } from "./plan-milestone.js";
import type { PlanSliceParams } from "./plan-slice.js";
import { handlePlanSlice } from "./plan-slice.js";
import type { ReplanSliceParams } from "./replan-slice.js";
import { handleReplanSlice } from "./replan-slice.js";
import type { ReopenMilestoneParams } from "./reopen-milestone.js";
import { handleReopenMilestone } from "./reopen-milestone.js";
import type { ReopenSliceParams } from "./reopen-slice.js";
import { handleReopenSlice } from "./reopen-slice.js";
import type { ReopenTaskParams } from "./reopen-task.js";
import { handleReopenTask } from "./reopen-task.js";
import type { ReassessRoadmapParams } from "./reassess-roadmap.js";
import { handleReassessRoadmap } from "./reassess-roadmap.js";
import type { ValidateMilestoneOptions, ValidateMilestoneParams } from "./validate-milestone.js";
import { handleValidateMilestone } from "./validate-milestone.js";
import { logError, logWarning } from "../workflow-logger.js";
import { invalidateStateCache } from "../state.js";
import { loadEffectiveGSDPreferences } from "../preferences.js";
import { parseProject } from "../schemas/parsers.js";
import { getAutoRuntimeSnapshot } from "../auto-runtime-state.js";
import {
  canonicalWorkflowToolName,
  parseMcpToolName,
  RUN_UAT_FORBIDDEN_TOOL_NAMES,
  RUN_UAT_WORKFLOW_TOOL_NAMES,
} from "../tool-presentation-plan.js";

export const SUPPORTED_SUMMARY_ARTIFACT_TYPES = [
  "SUMMARY",
  "RESEARCH",
  "CONTEXT",
  "ASSESSMENT",
  "CONTEXT-DRAFT",
  "PROJECT",
  "PROJECT-DRAFT",
  "REQUIREMENTS",
  "REQUIREMENTS-DRAFT",
] as const;

export function isSupportedSummaryArtifactType(
  artifactType: string,
): artifactType is (typeof SUPPORTED_SUMMARY_ARTIFACT_TYPES)[number] {
  return (SUPPORTED_SUMMARY_ARTIFACT_TYPES as readonly string[]).includes(artifactType);
}

function isRootSummaryArtifactType(artifactType: string): boolean {
  return artifactType === "PROJECT" ||
    artifactType === "PROJECT-DRAFT" ||
    artifactType === "REQUIREMENTS" ||
    artifactType === "REQUIREMENTS-DRAFT";
}

export interface ToolExecutionResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
  isError?: boolean;
}

function blockIfWrongAutoUnit(requiredUnitType: string, operation: string): ToolExecutionResult | null {
  const snapshot = getAutoRuntimeSnapshot();
  if (!snapshot.active || !snapshot.currentUnit) return null;
  if (snapshot.currentUnit.type === requiredUnitType) return null;

  const error = `HARD BLOCK: ${operation} may only run from ${requiredUnitType}; active unit is ${snapshot.currentUnit.type}. The orchestrator owns phase transitions.`;
  return {
    content: [{ type: "text", text: error }],
    details: { operation, error },
    isError: true,
  };
}

export interface SummarySaveParams {
  milestone_id?: string;
  slice_id?: string;
  task_id?: string;
  artifact_type: string;
  content: string;
}

function registerProjectMilestoneSequence(content: string): string[] {
  const parsed = parseProject(content);
  const registered: string[] = [];
  for (const milestone of parsed.milestones) {
    insertMilestone({
      id: milestone.id,
      title: milestone.title,
      status: milestone.done ? "complete" : "queued",
    });
    registered.push(milestone.id);
  }
  return registered;
}

async function mirrorArtifactToActiveWorktreeProjection(
  basePath: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const contract = resolveGsdPathContract(basePath);
  if (!contract.worktreeGsd) return;
  if (contract.worktreeGsd === contract.projectGsd) return;

  const fullPath = join(contract.worktreeGsd, relativePath);
  try {
    await saveFile(fullPath, content);
    clearPathCache();
    clearParseCache();
    invalidateStateCache();
  } catch (err) {
    logWarning("tool", `gsd_summary_save worktree projection mirror failed: ${(err as Error).message}`, {
      path: relativePath,
    });
  }
}

export async function executeSummarySave(
  params: SummarySaveParams,
  basePath: string = process.cwd(),
): Promise<ToolExecutionResult> {
  const dbAvailable = await ensureDbOpen(basePath);
  if (!dbAvailable) {
    return {
      content: [{ type: "text", text: "Error: GSD database is not available. Cannot save artifact." }],
      details: { operation: "save_summary", error: "db_unavailable" },
    isError: true,
      };
  }
  if (!isSupportedSummaryArtifactType(params.artifact_type)) {
    return {
      content: [{ type: "text", text: `Error: Invalid artifact_type "${params.artifact_type}". Must be one of: ${SUPPORTED_SUMMARY_ARTIFACT_TYPES.join(", ")}` }],
      details: { operation: "save_summary", error: "invalid_artifact_type" },
    isError: true,
      };
  }
  if (!isRootSummaryArtifactType(params.artifact_type) && !params.milestone_id) {
    return {
      content: [{ type: "text", text: `Error: milestone_id is required for artifact_type "${params.artifact_type}". Root-level artifacts must use PROJECT, PROJECT-DRAFT, REQUIREMENTS, or REQUIREMENTS-DRAFT.` }],
      details: { operation: "save_summary", error: "missing_milestone_id" },
      isError: true,
    };
  }
  const writeGateSnapshot = loadWriteGateSnapshot(basePath);
  const prefs = loadEffectiveGSDPreferences(basePath)?.preferences;
  const rootArtifactGuard = shouldBlockRootArtifactSaveInSnapshot(
    writeGateSnapshot,
    params.artifact_type,
    { requireVerifiedApproval: prefs?.planning_depth === "deep" },
  );
  if (rootArtifactGuard.block) {
    return {
      content: [{ type: "text", text: `Error saving artifact: ${rootArtifactGuard.reason ?? "root artifact write blocked"}` }],
      details: {
        operation: "save_summary",
        error: "root_artifact_write_blocked",
        displayReason: "Approval confirmation required before saving final project setup artifacts.",
      },
      isError: true,
    };
  }
  const contextGuard = shouldBlockContextArtifactSaveInSnapshot(
    writeGateSnapshot,
    params.artifact_type,
    params.milestone_id ?? null,
    params.slice_id ?? null,
  );
  if (contextGuard.block) {
    return {
      content: [{ type: "text", text: `Error saving artifact: ${contextGuard.reason ?? "context write blocked"}` }],
      details: {
        operation: "save_summary",
        error: "context_write_blocked",
        displayReason: "Depth check required before writing milestone context.",
      },
      isError: true,
    };
  }
  try {
    let relativePath: string;
    if (params.artifact_type === "PROJECT") {
      relativePath = "PROJECT.md";
    } else if (params.artifact_type === "PROJECT-DRAFT") {
      relativePath = "PROJECT-DRAFT.md";
    } else if (params.artifact_type === "REQUIREMENTS") {
      relativePath = "REQUIREMENTS.md";
    } else if (params.artifact_type === "REQUIREMENTS-DRAFT") {
      relativePath = "REQUIREMENTS-DRAFT.md";
    } else if (params.task_id && params.slice_id) {
      relativePath = `milestones/${params.milestone_id}/slices/${params.slice_id}/tasks/${params.task_id}-${params.artifact_type}.md`;
    } else if (params.slice_id) {
      relativePath = `milestones/${params.milestone_id}/slices/${params.slice_id}/${params.slice_id}-${params.artifact_type}.md`;
    } else {
      relativePath = `milestones/${params.milestone_id}/${params.milestone_id}-${params.artifact_type}.md`;
    }

    const activeRequirements = params.artifact_type === "REQUIREMENTS"
      ? getActiveRequirements()
      : null;
    if (params.artifact_type === "REQUIREMENTS" && activeRequirements?.length === 0) {
      return {
        content: [{ type: "text", text: "Error: Cannot save REQUIREMENTS artifact — no active requirements found in the database. Call gsd_requirement_save for each requirement before calling gsd_summary_save(REQUIREMENTS)." }],
        details: { operation: "save_summary", error: "no_active_requirements" },
        isError: true,
      };
    }

    const contentToSave = params.artifact_type === "REQUIREMENTS"
      ? generateRequirementsMd(activeRequirements ?? [])
      : params.content;
    const contentSource = params.artifact_type === "REQUIREMENTS"
      ? "requirements_table"
      : "provided_content";
    const isRootArtifact = isRootSummaryArtifactType(params.artifact_type);

    await saveArtifactToDb(
      {
        path: relativePath,
        artifact_type: params.artifact_type,
        content: contentToSave,
        milestone_id: isRootArtifact ? undefined : params.milestone_id,
        slice_id: isRootArtifact ? undefined : params.slice_id,
        task_id: isRootArtifact ? undefined : params.task_id,
      },
      basePath,
    );
    await mirrorArtifactToActiveWorktreeProjection(basePath, relativePath, contentToSave);

    let registeredMilestones: string[] = [];
    if (params.artifact_type === "PROJECT") {
      try {
        registeredMilestones = registerProjectMilestoneSequence(contentToSave);
        if (registeredMilestones.length > 0) invalidateStateCache();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError("tool", `gsd_summary_save: PROJECT artifact persisted but milestone registration threw: ${msg}`, {
          tool: "gsd_summary_save",
          error: String(err),
          stack: err instanceof Error ? err.stack ?? "" : "",
        });
        // PROJECT.md was persisted by saveArtifactToDb above; the artifacts row
        // changed even though no milestones registered. Invalidate so subsequent
        // /gsd reads see the persisted artifact instead of the pre-save cache.
        invalidateStateCache();
        return {
          content: [{
            type: "text",
            text:
              `Error: PROJECT.md was saved to ${relativePath} but milestone registration failed: ${msg}. ` +
              `The DB has no milestone rows for this project, so /gsd will report "No Active Milestone". ` +
              `Re-call gsd_summary_save(PROJECT) once the underlying error is resolved — INSERT OR IGNORE makes registration idempotent.`,
          }],
          details: {
            operation: "save_summary",
            path: relativePath,
            artifact_type: params.artifact_type,
            error: "milestone_registration_threw",
            registration_error: msg,
          },
          isError: true,
        };
      }
      if (registeredMilestones.length === 0) {
        logError("tool", `gsd_summary_save: PROJECT.md saved to ${relativePath} but parsed zero milestones — registration produced no DB rows`, {
          tool: "gsd_summary_save",
        });
        // PROJECT.md was persisted; invalidate so subsequent reads see the new
        // artifacts row even though no milestones registered.
        invalidateStateCache();
        return {
          content: [{
            type: "text",
            text:
              `Error: PROJECT.md was saved to ${relativePath} but contains zero parseable milestone lines, ` +
              `so no milestones were registered in the DB. /gsd will report "No Active Milestone". ` +
              `Rewrite PROJECT.md so the "Milestone Sequence" section uses canonical lines: ` +
              `\`- [ ] M001: <Title> — <One-liner>\` (em-dash, double-dash \`--\`, or single-dash \`-\` separator), then re-call gsd_summary_save(PROJECT).`,
          }],
          details: {
            operation: "save_summary",
            path: relativePath,
            artifact_type: params.artifact_type,
            error: "milestone_registration_empty_parse",
          },
          isError: true,
        };
      }
    }

    if (params.artifact_type === "CONTEXT" && !params.task_id) {
      try {
        const draftFile = params.slice_id
          ? resolveSliceFile(basePath, params.milestone_id!, params.slice_id, "CONTEXT-DRAFT")
          : resolveMilestoneFile(basePath, params.milestone_id!, "CONTEXT-DRAFT");
        if (draftFile) unlinkSync(draftFile);
      } catch (e) {
        logWarning("tool", `CONTEXT-DRAFT.md unlink failed: ${(e as Error).message}`);
      }
    }

    return {
      content: [{ type: "text", text: `Saved ${params.artifact_type} artifact to ${relativePath}` }],
      details: {
        operation: "save_summary",
        path: relativePath,
        artifact_type: params.artifact_type,
        content_source: contentSource,
        ...(registeredMilestones.length > 0 ? { registeredMilestones } : {}),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("tool", `gsd_summary_save tool failed: ${msg}`, { tool: "gsd_summary_save", error: String(err) });
    return {
      content: [{ type: "text", text: `Error saving artifact: ${msg}` }],
      details: { operation: "save_summary", error: msg },
    isError: true,
      };
  }
}

type VerificationEvidenceInput =
  | {
      command: string;
      exitCode: number;
      verdict: string;
      durationMs: number;
    }
  | string;

interface TaskEscalationInput {
  question: string;
  options: EscalationOption[];
  recommendation: string;
  recommendationRationale: string;
  continueWithDefault: boolean;
}

export interface TaskCompleteParams {
  taskId: string;
  sliceId: string;
  milestoneId: string;
  oneLiner: string;
  narrative: string;
  verification?: string;
  deviations?: string;
  knownIssues?: string;
  keyFiles?: string[];
  keyDecisions?: string[];
  blockerDiscovered?: boolean;
  escalation?: TaskEscalationInput;
  verificationEvidence?: VerificationEvidenceInput[];
}

type NormalizedVerificationEvidence = {
  command: string;
  exitCode: number;
  verdict: string;
  durationMs: number;
};

function normalizeVerificationEvidence(
  evidence: VerificationEvidenceInput[] | undefined,
): NormalizedVerificationEvidence[] {
  return (evidence ?? []).map((entry) =>
    typeof entry === "string"
      ? { command: entry, exitCode: -1, verdict: "unknown (coerced from string)", durationMs: 0 }
      : entry,
  );
}

function deriveVerificationSummary(
  evidence: NormalizedVerificationEvidence[],
): string | null {
  if (evidence.length === 0) return null;

  const rendered = evidence.slice(0, 3).map((entry) => {
    const command = entry.command.trim() || "(unspecified command)";
    const verdict = entry.verdict.trim() || "recorded";
    return `\`${command}\` exited ${entry.exitCode} (${verdict})`;
  });
  const suffix = evidence.length > rendered.length
    ? `; ${evidence.length - rendered.length} more check(s) recorded`
    : "";

  return `Verification evidence recorded: ${rendered.join("; ")}${suffix}.`;
}

export type CompleteMilestoneExecutorParams = Partial<CompleteMilestoneParams> & Record<string, unknown>;
export type SliceCompleteExecutorParams = CompleteSliceParams;
export type PlanMilestoneExecutorParams = PlanMilestoneParams;
export type PlanSliceExecutorParams = PlanSliceParams;
export type ReplanSliceExecutorParams = ReplanSliceParams;
export type ReopenTaskExecutorParams = ReopenTaskParams;
export type ReopenSliceExecutorParams = ReopenSliceParams;
export type ReopenMilestoneExecutorParams = ReopenMilestoneParams;
export type ValidateMilestoneExecutorParams = ValidateMilestoneParams;
export type ReassessRoadmapExecutorParams = ReassessRoadmapParams;

export interface SaveGateResultParams {
  milestoneId: string;
  sliceId: string;
  gateId: string;
  taskId?: string;
  verdict: "pass" | "flag" | "omitted";
  rationale: string;
  findings?: string;
}

export type UatType =
  | "artifact-driven"
  | "browser-executable"
  | "runtime-executable"
  | "live-runtime"
  | "mixed"
  | "human-experience";

export type UatVerdict = "PASS" | "FAIL" | "PARTIAL";
export type UatCheckResult = "PASS" | "FAIL" | "NEEDS-HUMAN";

export interface UatEvidenceRef {
  kind: "gsd_uat_exec" | "gsd_exec" | "screenshot" | "log" | "url" | "browser";
  ref: string;
  note?: string;
}

export interface UatCheckResultInput {
  id: string;
  description: string;
  mode: "artifact" | "runtime" | "browser" | "human-follow-up";
  result: UatCheckResult;
  evidence?: UatEvidenceRef[];
  notes?: string;
  nonAutomatable?: boolean;
}

export interface UatPresentationInput {
  surface: "provider-tools" | "claude-code-sdk" | "mcp" | "hybrid";
  model?: { provider?: string; api?: string; id?: string };
  presentedTools: string[];
  blockedTools: Array<{ name: string; reason: string }>;
  aliases?: Array<{ requested: string; canonical: string }>;
  fallbackToolsUsed?: string[];
  toolPresentationPlanId?: string;
  notes?: string;
}

export interface UatResultSaveParams {
  milestoneId: string;
  sliceId: string;
  uatType: UatType;
  verdict: UatVerdict;
  checks: UatCheckResultInput[];
  presentation: UatPresentationInput;
  notes?: string;
  attempt?: number | string | "auto";
  previousAttemptId?: string;
}

export async function executeTaskComplete(
  params: TaskCompleteParams,
  basePath: string = process.cwd(),
): Promise<ToolExecutionResult> {
  const dbAvailable = await ensureDbOpen(basePath);
  if (!dbAvailable) {
    return {
      content: [{ type: "text", text: "Error: GSD database is not available. Cannot complete task." }],
      details: { operation: "complete_task", error: "db_unavailable" },
    isError: true,
      };
  }
  try {
    const coerced = { ...params };
    const verificationEvidence = normalizeVerificationEvidence(params.verificationEvidence);
    coerced.verificationEvidence = verificationEvidence;

    const verification = typeof params.verification === "string" ? params.verification.trim() : "";
    if (verification.length === 0) {
      const derived = deriveVerificationSummary(verificationEvidence);
      if (derived) {
        coerced.verification = derived;
      } else if (params.blockerDiscovered === true) {
        coerced.verification = "Not run: blocker discovered before verification.";
      } else {
        return {
          content: [{
            type: "text",
            text: "Error completing task: verification is required unless verificationEvidence is provided or blockerDiscovered is true.",
          }],
          details: { operation: "complete_task", error: "verification_required" },
          isError: true,
        };
      }
    }

    const result = await handleCompleteTask(coerced as any, basePath);
    if ("error" in result) {
      return {
        content: [{ type: "text", text: `Error completing task: ${result.error}` }],
        details: { operation: "complete_task", error: result.error },
      isError: true,
      };
    }
    if (result.escalation) {
      const recommended = result.escalation.options.find((option) => option.id === result.escalation?.recommendation);
      const optionIds = result.escalation.options.map((option) => option.id).join("|");
      return {
        content: [{
          type: "text",
          text: [
            `Task completed with escalation decision required: ${result.escalation.question}`,
            `Recommendation: ${result.escalation.recommendation}${recommended ? ` (${recommended.label})` : ""} — ${result.escalation.recommendationRationale}`,
            `Resolve with: /gsd escalate resolve ${result.taskId} <${optionIds}|accept|reject-blocker> [rationale...]`,
          ].join("\n"),
        }],
        details: {
          operation: "complete_task",
          taskId: result.taskId,
          sliceId: result.sliceId,
          milestoneId: result.milestoneId,
          summaryPath: result.summaryPath,
          escalation: result.escalation,
        },
      };
    }
    return {
      content: [{ type: "text", text: `Completed task ${result.taskId} (${result.sliceId}/${result.milestoneId})` }],
      details: {
        operation: "complete_task",
        taskId: result.taskId,
        sliceId: result.sliceId,
        milestoneId: result.milestoneId,
        summaryPath: result.summaryPath,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("tool", `complete_task tool failed: ${msg}`, { tool: "gsd_task_complete", error: String(err) });
    return {
      content: [{ type: "text", text: `Error completing task: ${msg}` }],
      details: { operation: "complete_task", error: msg },
    isError: true,
      };
  }
}

export async function executeTaskReopen(
  params: ReopenTaskExecutorParams,
  basePath: string = process.cwd(),
): Promise<ToolExecutionResult> {
  const dbAvailable = await ensureDbOpen(basePath);
  if (!dbAvailable) {
    return {
      content: [{ type: "text", text: "Error: GSD database is not available. Cannot reopen task." }],
      details: { operation: "reopen_task", error: "db_unavailable" },
      isError: true,
    };
  }
  try {
    const result = await handleReopenTask(params, basePath);
    if ("error" in result) {
      return {
        content: [{ type: "text", text: `Error reopening task: ${result.error}` }],
        details: { operation: "reopen_task", error: result.error },
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `Reopened task ${result.taskId} (${result.sliceId}/${result.milestoneId})` }],
      details: {
        operation: "reopen_task",
        taskId: result.taskId,
        sliceId: result.sliceId,
        milestoneId: result.milestoneId,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("tool", `reopen_task tool failed: ${msg}`, { tool: "gsd_task_reopen", error: String(err) });
    return {
      content: [{ type: "text", text: `Error reopening task: ${msg}` }],
      details: { operation: "reopen_task", error: msg },
      isError: true,
    };
  }
}

export async function executeSliceReopen(
  params: ReopenSliceExecutorParams,
  basePath: string = process.cwd(),
): Promise<ToolExecutionResult> {
  const dbAvailable = await ensureDbOpen(basePath);
  if (!dbAvailable) {
    return {
      content: [{ type: "text", text: "Error: GSD database is not available. Cannot reopen slice." }],
      details: { operation: "reopen_slice", error: "db_unavailable" },
      isError: true,
    };
  }
  try {
    const result = await handleReopenSlice(params, basePath);
    if ("error" in result) {
      return {
        content: [{ type: "text", text: `Error reopening slice: ${result.error}` }],
        details: { operation: "reopen_slice", error: result.error },
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `Reopened slice ${result.sliceId} (${result.milestoneId})` }],
      details: {
        operation: "reopen_slice",
        sliceId: result.sliceId,
        milestoneId: result.milestoneId,
        tasksReset: result.tasksReset,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("tool", `reopen_slice tool failed: ${msg}`, { tool: "gsd_slice_reopen", error: String(err) });
    return {
      content: [{ type: "text", text: `Error reopening slice: ${msg}` }],
      details: { operation: "reopen_slice", error: msg },
      isError: true,
    };
  }
}

export async function executeMilestoneReopen(
  params: ReopenMilestoneExecutorParams,
  basePath: string = process.cwd(),
): Promise<ToolExecutionResult> {
  const dbAvailable = await ensureDbOpen(basePath);
  if (!dbAvailable) {
    return {
      content: [{ type: "text", text: "Error: GSD database is not available. Cannot reopen milestone." }],
      details: { operation: "reopen_milestone", error: "db_unavailable" },
      isError: true,
    };
  }
  try {
    const result = await handleReopenMilestone(params, basePath);
    if ("error" in result) {
      return {
        content: [{ type: "text", text: `Error reopening milestone: ${result.error}` }],
        details: { operation: "reopen_milestone", error: result.error },
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `Reopened milestone ${result.milestoneId}` }],
      details: {
        operation: "reopen_milestone",
        milestoneId: result.milestoneId,
        slicesReset: result.slicesReset,
        tasksReset: result.tasksReset,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("tool", `reopen_milestone tool failed: ${msg}`, { tool: "gsd_milestone_reopen", error: String(err) });
    return {
      content: [{ type: "text", text: `Error reopening milestone: ${msg}` }],
      details: { operation: "reopen_milestone", error: msg },
      isError: true,
    };
  }
}

export async function executeSliceComplete(
  params: SliceCompleteExecutorParams,
  basePath: string = process.cwd(),
): Promise<ToolExecutionResult> {
  const unitGuard = blockIfWrongAutoUnit("complete-slice", "complete_slice");
  if (unitGuard) return unitGuard;

  const dbAvailable = await ensureDbOpen(basePath);
  if (!dbAvailable) {
    return {
      content: [{ type: "text", text: "Error: GSD database is not available. Cannot complete slice." }],
      details: { operation: "complete_slice", error: "db_unavailable" },
    isError: true,
      };
  }
  try {
    const splitPair = (s: string): [string, string] => {
      const m = s.match(/^(.+?)\s*(?:—|-)\s+(.+)$/);
      return m ? [m[1].trim(), m[2].trim()] : [s.trim(), ""];
    };
    const wrapOptionalArray = (v: unknown): unknown[] | undefined =>
      v == null ? undefined : Array.isArray(v) ? v : [v];
    const coerced = Object.fromEntries(
      Object.entries(params).filter(([, value]) => value !== undefined && value !== null),
    ) as CompleteSliceParams & Record<string, unknown>;
    const provides = wrapOptionalArray(params.provides);
    if (provides !== undefined) coerced.provides = provides as string[];
    const keyFiles = wrapOptionalArray(params.keyFiles);
    if (keyFiles !== undefined) coerced.keyFiles = keyFiles as string[];
    const keyDecisions = wrapOptionalArray(params.keyDecisions);
    if (keyDecisions !== undefined) coerced.keyDecisions = keyDecisions as string[];
    const patternsEstablished = wrapOptionalArray(params.patternsEstablished);
    if (patternsEstablished !== undefined) coerced.patternsEstablished = patternsEstablished as string[];
    const observabilitySurfaces = wrapOptionalArray(params.observabilitySurfaces);
    if (observabilitySurfaces !== undefined) coerced.observabilitySurfaces = observabilitySurfaces as string[];
    const requirementsSurfaced = wrapOptionalArray(params.requirementsSurfaced);
    if (requirementsSurfaced !== undefined) coerced.requirementsSurfaced = requirementsSurfaced as string[];
    const drillDownPaths = wrapOptionalArray(params.drillDownPaths);
    if (drillDownPaths !== undefined) coerced.drillDownPaths = drillDownPaths as string[];
    const affects = wrapOptionalArray(params.affects);
    if (affects !== undefined) coerced.affects = affects as string[];
    const filesModified = wrapOptionalArray(params.filesModified);
    if (filesModified !== undefined) coerced.filesModified = filesModified.map((f) => {
      if (typeof f !== "string") return f;
      const [path, description] = splitPair(f);
      return { path, description };
    }) as Array<{ path: string; description: string }>;
    const requires = wrapOptionalArray(params.requires);
    if (requires !== undefined) coerced.requires = requires.map((r) => {
      if (typeof r !== "string") return r;
      const [slice, provides] = splitPair(r);
      return { slice, provides };
    }) as Array<{ slice: string; provides: string }>;
    const requirementsAdvanced = wrapOptionalArray(params.requirementsAdvanced);
    if (requirementsAdvanced !== undefined) coerced.requirementsAdvanced = requirementsAdvanced.map((r) => {
      if (typeof r !== "string") return r;
      const [id, how] = splitPair(r);
      return { id, how };
    }) as Array<{ id: string; how: string }>;
    const requirementsValidated = wrapOptionalArray(params.requirementsValidated);
    if (requirementsValidated !== undefined) coerced.requirementsValidated = requirementsValidated.map((r) => {
      if (typeof r !== "string") return r;
      const [id, proof] = splitPair(r);
      return { id, proof };
    }).map((r) => {
      if (!r || typeof r !== "object" || Array.isArray(r)) return r;
      const record = r as Record<string, unknown>;
      if (typeof record.id === "string" && typeof record.proof !== "string" && typeof record.how === "string") {
        return { id: record.id, proof: record.how };
      }
      return r;
    }) as Array<{ id: string; proof: string }>;
    const requirementsInvalidated = wrapOptionalArray(params.requirementsInvalidated);
    if (requirementsInvalidated !== undefined) coerced.requirementsInvalidated = requirementsInvalidated.map((r) => {
      if (typeof r !== "string") return r;
      const [id, what] = splitPair(r);
      return { id, what };
    }).map((r) => {
      if (!r || typeof r !== "object" || Array.isArray(r)) return r;
      const record = r as Record<string, unknown>;
      if (typeof record.id === "string" && typeof record.what !== "string" && typeof record.how === "string") {
        return { id: record.id, what: record.how };
      }
      return r;
    }) as Array<{ id: string; what: string }>;

    const result = await handleCompleteSlice(coerced as CompleteSliceParams, basePath);
    if ("error" in result) {
      return {
        content: [{ type: "text", text: `Error completing slice: ${result.error}` }],
        details: { operation: "complete_slice", error: result.error },
      isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `Completed slice ${result.sliceId} (${result.milestoneId})` }],
      details: {
        operation: "complete_slice",
        sliceId: result.sliceId,
        milestoneId: result.milestoneId,
        summaryPath: result.summaryPath,
        uatPath: result.uatPath,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("tool", `complete_slice tool failed: ${msg}`, { tool: "gsd_slice_complete", error: String(err) });
    return {
      content: [{ type: "text", text: `Error completing slice: ${msg}` }],
      details: { operation: "complete_slice", error: msg },
    isError: true,
      };
  }
}

export async function executeCompleteMilestone(
  params: CompleteMilestoneExecutorParams,
  basePath: string = process.cwd(),
): Promise<ToolExecutionResult> {
  const unitGuard = blockIfWrongAutoUnit("complete-milestone", "complete_milestone");
  if (unitGuard) return unitGuard;

  const dbAvailable = await ensureDbOpen(basePath);
  if (!dbAvailable) {
    return {
      content: [{ type: "text", text: "Error: GSD database is not available. Cannot complete milestone." }],
      details: { operation: "complete_milestone", error: "db_unavailable" },
    isError: true,
      };
  }
  try {
    const sanitized = sanitizeCompleteMilestoneParams(params);
    const result = await handleCompleteMilestone(sanitized, basePath);
    if ("error" in result) {
      return {
        content: [{ type: "text", text: `Error completing milestone: ${result.error}` }],
        details: { operation: "complete_milestone", error: result.error },
      isError: true,
      };
    }
    const message = result.alreadyComplete
      ? `Milestone ${result.milestoneId} is already complete. Summary available at ${result.summaryPath}`
      : `Completed milestone ${result.milestoneId}. Summary written to ${result.summaryPath}`;
    return {
      content: [{ type: "text", text: message }],
      details: {
        operation: "complete_milestone",
        milestoneId: result.milestoneId,
        summaryPath: result.summaryPath,
        ...(result.alreadyComplete ? { alreadyComplete: true } : {}),
        ...(result.stale ? { stale: true } : {}),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("tool", `complete_milestone tool failed: ${msg}`, { tool: "gsd_complete_milestone", error: String(err) });
    return {
      content: [{ type: "text", text: `Error completing milestone: ${msg}` }],
      details: { operation: "complete_milestone", error: msg },
    isError: true,
      };
  }
}

export async function executeValidateMilestone(
  params: ValidateMilestoneExecutorParams,
  basePath: string = process.cwd(),
  opts?: ValidateMilestoneOptions,
): Promise<ToolExecutionResult> {
  const unitGuard = blockIfWrongAutoUnit("validate-milestone", "validate_milestone");
  if (unitGuard) return unitGuard;

  const dbAvailable = await ensureDbOpen(basePath);
  if (!dbAvailable) {
    return {
      content: [{ type: "text", text: "Error: GSD database is not available. Cannot validate milestone." }],
      details: { operation: "validate_milestone", error: "db_unavailable" },
    isError: true,
      };
  }
  try {
    const result = await handleValidateMilestone(params, basePath, opts);
    if ("error" in result) {
      return {
        content: [{ type: "text", text: `Error validating milestone: ${result.error}` }],
        details: { operation: "validate_milestone", error: result.error },
      isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `Validated milestone ${result.milestoneId} — verdict: ${result.verdict}. Written to ${result.validationPath}` }],
      details: {
        operation: "validate_milestone",
        milestoneId: result.milestoneId,
        verdict: result.verdict,
        validationPath: result.validationPath,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("tool", `validate_milestone tool failed: ${msg}`, { tool: "gsd_validate_milestone", error: String(err) });
    return {
      content: [{ type: "text", text: `Error validating milestone: ${msg}` }],
      details: { operation: "validate_milestone", error: msg },
    isError: true,
      };
  }
}

export async function executeReassessRoadmap(
  params: ReassessRoadmapExecutorParams,
  basePath: string = process.cwd(),
): Promise<ToolExecutionResult> {
  const dbAvailable = await ensureDbOpen(basePath);
  if (!dbAvailable) {
    return {
      content: [{ type: "text", text: "Error: GSD database is not available. Cannot reassess roadmap." }],
      details: { operation: "reassess_roadmap", error: "db_unavailable" },
    isError: true,
      };
  }
  try {
    const result = await handleReassessRoadmap(params, basePath);
    if ("error" in result) {
      return {
        content: [{ type: "text", text: `Error reassessing roadmap: ${result.error}` }],
        details: { operation: "reassess_roadmap", error: result.error },
      isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `Reassessed roadmap for milestone ${result.milestoneId} after ${result.completedSliceId}` }],
      details: {
        operation: "reassess_roadmap",
        milestoneId: result.milestoneId,
        completedSliceId: result.completedSliceId,
        assessmentPath: result.assessmentPath,
        roadmapPath: result.roadmapPath,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("tool", `reassess_roadmap tool failed: ${msg}`, { tool: "gsd_reassess_roadmap", error: String(err) });
    return {
      content: [{ type: "text", text: `Error reassessing roadmap: ${msg}` }],
      details: { operation: "reassess_roadmap", error: msg },
    isError: true,
      };
  }
}

export async function executeSaveGateResult(
  params: SaveGateResultParams,
  basePath: string = process.cwd(),
): Promise<ToolExecutionResult> {
  const dbAvailable = await ensureDbOpen(basePath);
  if (!dbAvailable) {
    return {
      content: [{ type: "text", text: "Error: GSD database is not available." }],
      details: { operation: "save_gate_result", error: "db_unavailable" },
    isError: true,
      };
  }

  // Source of truth: gate-registry.ts. Every declared GateId is accepted,
  // so adding a new gate in one place automatically flows through here.
  const validGates = Object.keys(GATE_REGISTRY);
  if (!validGates.includes(params.gateId)) {
    return {
      content: [{ type: "text", text: `Error: Invalid gateId "${params.gateId}". Must be one of: ${validGates.join(", ")}` }],
      details: { operation: "save_gate_result", error: "invalid_gate_id" },
    isError: true,
      };
  }

  const validVerdicts = ["pass", "flag", "omitted"];
  if (!validVerdicts.includes(params.verdict)) {
    return {
      content: [{ type: "text", text: `Error: Invalid verdict "${params.verdict}". Must be one of: ${validVerdicts.join(", ")}` }],
      details: { operation: "save_gate_result", error: "invalid_verdict" },
    isError: true,
      };
  }

  try {
    saveGateResult({
      milestoneId: params.milestoneId,
      sliceId: params.sliceId,
      gateId: params.gateId,
      taskId: params.taskId ?? "",
      verdict: params.verdict,
      rationale: params.rationale,
      findings: params.findings ?? "",
    });
    invalidateStateCache();
    return {
      content: [{ type: "text", text: `Gate ${params.gateId} result saved: verdict=${params.verdict}` }],
      details: { operation: "save_gate_result", gateId: params.gateId, verdict: params.verdict },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("tool", `gsd_save_gate_result failed: ${msg}`, { tool: "gsd_save_gate_result", error: String(err) });
    return {
      content: [{ type: "text", text: `Error saving gate result: ${msg}` }],
      details: { operation: "save_gate_result", error: msg },
    isError: true,
      };
  }
}

function errorResult(operation: string, message: string, error: string): ToolExecutionResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    details: { operation, error },
    isError: true,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function ensureUatRequiredFields(params: UatResultSaveParams): string | null {
  if (!isNonEmptyString(params.milestoneId)) return "milestoneId is required";
  if (!isNonEmptyString(params.sliceId)) return "sliceId is required";
  if (!isNonEmptyString(params.uatType)) return "uatType is required";
  if (!["PASS", "FAIL", "PARTIAL"].includes(params.verdict)) return "verdict must be PASS, FAIL, or PARTIAL";
  if (!Array.isArray(params.checks) || params.checks.length === 0) return "checks must contain at least one UAT check";
  if (!params.presentation || !Array.isArray(params.presentation.presentedTools)) return "presentation.presentedTools is required";
  if (!Array.isArray(params.presentation.blockedTools)) return "presentation.blockedTools is required";
  return null;
}

function approvedEvidenceRoots(basePath: string): string[] {
  const contract = resolveGsdPathContract(basePath);
  return [contract.worktreeGsd, contract.projectGsd].filter((root): root is string => typeof root === "string");
}

function approvedBrowserArtifactRoots(basePath: string): string[] {
  const contract = resolveGsdPathContract(basePath);
  const roots = [contract.workRoot, contract.projectRoot].map((root) => join(root, ".artifacts", "browser"));
  return [...new Set(roots)];
}

function pathStartsWithin(parent: string, target: string): boolean {
  const normalizedParent = parent.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedTarget = target.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalizedTarget === normalizedParent || normalizedTarget.startsWith(`${normalizedParent}/`);
}

function pushUnique(paths: string[], candidate: string): void {
  if (!paths.includes(candidate)) paths.push(candidate);
}

function execMetaPathCandidates(basePath: string, ref: string): string[] {
  const trimmed = ref.trim();
  const candidates: string[] = [];
  const execDirs = approvedEvidenceRoots(basePath).map((root) => join(root, "exec"));
  const normalizedRef = trimmed.replace(/\\/g, "/");
  const pathLike = normalizedRef.endsWith(".meta.json") || normalizedRef.includes("/.gsd/exec/");

  if (pathLike) {
    const rawPath = isAbsolute(trimmed) ? resolve(trimmed) : resolve(basePath, trimmed);
    pushUnique(candidates, rawPath);

    const relativeExecMarker = ".gsd/exec/";
    const markerIndex = normalizedRef.indexOf(relativeExecMarker);
    if (markerIndex >= 0) {
      const execRelative = normalizedRef.slice(markerIndex + relativeExecMarker.length);
      for (const execDir of execDirs) {
        pushUnique(candidates, join(execDir, execRelative));
      }
    }

    return candidates.filter((candidate) =>
      execDirs.some((execDir) => pathStartsWithin(execDir, candidate))
    );
  }

  for (const execDir of execDirs) {
    pushUnique(candidates, join(execDir, `${trimmed}.meta.json`));
  }
  return candidates;
}

function resolveExecMetaPath(basePath: string, ref: string): string | null {
  for (const candidate of execMetaPathCandidates(basePath, ref)) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function evidencePathIsApproved(basePath: string, ref: string): boolean {
  const normalizedRef = ref.replace(/\\/g, "/");
  if (normalizedRef.startsWith(".gsd/exec/") || normalizedRef.startsWith(".gsd/uat/")) return true;
  if (normalizedRef.startsWith(".artifacts/browser/")) {
    const resolvedRef = resolve(basePath, ref);
    return approvedBrowserArtifactRoots(basePath).some((root) => pathStartsWithin(root, resolvedRef));
  }
  const gsdEvidenceApproved = approvedEvidenceRoots(basePath).some((root) => {
    return pathStartsWithin(join(root, "exec"), ref) || pathStartsWithin(join(root, "uat"), ref);
  });
  if (gsdEvidenceApproved) return true;
  return approvedBrowserArtifactRoots(basePath).some((root) => pathStartsWithin(root, ref));
}

function validateEvidenceRef(basePath: string, evidence: UatEvidenceRef): string | null {
  if (!isNonEmptyString(evidence.ref)) return "evidence.ref is required";
  if (evidence.kind === "gsd_uat_exec" || evidence.kind === "gsd_exec") {
    const path = resolveExecMetaPath(basePath, evidence.ref.trim());
    if (!path) return `missing gsd_exec metadata for evidence id "${evidence.ref}"`;
    if (evidence.kind === "gsd_uat_exec") {
      try {
        const meta = JSON.parse(readFileSync(path, "utf-8")) as { metadata?: { kind?: unknown } };
        if (meta.metadata?.kind !== "uat_exec") return `evidence id "${evidence.ref}" is not typed as uat_exec`;
      } catch {
        return `invalid gsd_exec metadata JSON for evidence id "${evidence.ref}"`;
      }
    }
    return null;
  }
  if (evidence.kind === "url") {
    try {
      const parsed = new URL(evidence.ref);
      return parsed.protocol === "http:" || parsed.protocol === "https:"
        ? null
        : `invalid URL evidence ref "${evidence.ref}"`;
    } catch {
      return `invalid URL evidence ref "${evidence.ref}"`;
    }
  }
  return evidencePathIsApproved(basePath, evidence.ref)
    ? null
    : `evidence ref "${evidence.ref}" is outside approved evidence locations`;
}

function validateUatChecks(basePath: string, params: UatResultSaveParams): string | null {
  for (const check of params.checks) {
    if (!isNonEmptyString(check.id)) return "every check must have a non-empty id";
    if (!isNonEmptyString(check.description)) return `check ${check.id} must have a description`;
    if (!["artifact", "runtime", "browser", "human-follow-up"].includes(check.mode)) {
      return `check ${check.id} has invalid mode "${check.mode}"`;
    }
    if (!["PASS", "FAIL", "NEEDS-HUMAN"].includes(check.result)) {
      return `check ${check.id} has invalid result "${check.result}"`;
    }
    if (check.result === "PASS" || check.result === "FAIL") {
      if (!Array.isArray(check.evidence) || check.evidence.length === 0) {
        return `check ${check.id} is ${check.result} but has no objective evidence`;
      }
      for (const evidence of check.evidence) {
        const error = validateEvidenceRef(basePath, evidence);
        if (error) return `check ${check.id}: ${error}`;
      }
    } else if (!isNonEmptyString(check.notes)) {
      return `check ${check.id} is NEEDS-HUMAN but has no manual instruction or reason`;
    }
  }
  return null;
}

function validateUatMode(params: UatResultSaveParams): string | null {
  const modes = new Set(params.checks.map((check) => check.mode));
  const hasHuman = params.checks.some((check) => check.result === "NEEDS-HUMAN");
  if (params.uatType === "artifact-driven" && hasHuman && params.verdict === "PASS") {
    return "artifact-driven UAT cannot PASS with human-only checks";
  }
  if (
    hasHuman &&
    params.verdict === "PASS" &&
    !["human-experience", "mixed", "live-runtime"].includes(params.uatType) &&
    !params.checks.every((check) => check.result !== "NEEDS-HUMAN" || check.nonAutomatable === true)
  ) {
    return "NEEDS-HUMAN checks can only coexist with PASS for human-experience, mixed, live-runtime, or explicitly non-automatable checks";
  }
  if (params.uatType === "runtime-executable" && !modes.has("runtime")) {
    return "runtime-executable UAT requires at least one runtime check";
  }
  if (params.uatType === "browser-executable" && !modes.has("browser")) {
    return "browser-executable UAT requires at least one browser check";
  }
  if (params.uatType === "live-runtime" && !modes.has("runtime") && !modes.has("browser")) {
    return "live-runtime UAT requires runtime or browser evidence";
  }
  return null;
}

function quoteToolNames(toolNames: readonly string[]): string {
  return toolNames.map((toolName) => `"${toolName}"`).join(", ");
}

function validateCanonicalPresentation(params: UatResultSaveParams): string | null {
  const aliasHints: Record<string, string> = {
    gsd_save_summary: "gsd_summary_save",
    gsd_complete_task: "gsd_task_complete",
    gsd_complete_slice: "gsd_slice_complete",
    gsd_milestone_complete: "gsd_complete_milestone",
  };
  const errors: string[] = [];
  for (const toolName of params.presentation.presentedTools) {
    const baseName = parseMcpToolName(toolName)?.tool ?? toolName;
    const canonical = aliasHints[baseName];
    if (canonical) errors.push(`presentation tool "${toolName}" uses an alias; use canonical "${canonical}"`);
  }

  const presentedCanonical = new Set(
    params.presentation.presentedTools.map((toolName) =>
      canonicalWorkflowToolName(parseMcpToolName(toolName)?.tool ?? toolName)
    ),
  );
  const missingRequiredTools = RUN_UAT_WORKFLOW_TOOL_NAMES.filter(
    (requiredTool) => !presentedCanonical.has(requiredTool),
  );
  if (missingRequiredTools.length === 1) {
    errors.push(`presentation is missing required UAT tool "${missingRequiredTools[0]}"`);
  } else if (missingRequiredTools.length > 1) {
    errors.push(`presentation is missing required UAT tools ${quoteToolNames(missingRequiredTools)}`);
  }

  const forbiddenCanonical = new Set(
    RUN_UAT_FORBIDDEN_TOOL_NAMES
      .filter((toolName) => !toolName.includes("*"))
      .map((toolName) => canonicalWorkflowToolName(parseMcpToolName(toolName)?.tool ?? toolName)),
  );
  const forbiddenPresentedTools: string[] = [];
  for (const toolName of params.presentation.presentedTools) {
    const canonical = canonicalWorkflowToolName(parseMcpToolName(toolName)?.tool ?? toolName);
    if (toolName === "mcp__gsd-workflow__*" || forbiddenCanonical.has(canonical)) {
      forbiddenPresentedTools.push(toolName);
    }
  }
  if (forbiddenPresentedTools.length === 1) {
    errors.push(`presentation includes forbidden run-uat tool "${forbiddenPresentedTools[0]}"`);
  } else if (forbiddenPresentedTools.length > 1) {
    errors.push(`presentation includes forbidden run-uat tools ${quoteToolNames(forbiddenPresentedTools)}`);
  }

  const blockedCanonical = new Set(
    params.presentation.blockedTools.map((entry) =>
      canonicalWorkflowToolName(parseMcpToolName(entry.name)?.tool ?? entry.name)
    ),
  );
  const missingBlockedTools = ["gsd_exec", "gsd_summary_save", "gsd_save_gate_result"].filter(
    (blockedTool) => !blockedCanonical.has(blockedTool),
  );
  if (missingBlockedTools.length === 1) {
    errors.push(`presentation must record "${missingBlockedTools[0]}" as blocked during run-uat`);
  } else if (missingBlockedTools.length > 1) {
    errors.push(`presentation must record ${quoteToolNames(missingBlockedTools)} as blocked during run-uat`);
  }
  return errors.length > 0 ? errors.join("; ") : null;
}

function nextUatAttempt(basePath: string, milestoneId: string, sliceId: string): number {
  const contract = resolveGsdPathContract(basePath);
  const dir = join(contract.projectGsd, "uat", milestoneId, sliceId);
  if (!existsSync(dir)) return 1;
  let max = 0;
  for (const entry of readdirSync(dir)) {
    const match = /^attempt-(\d+)\.json$/.exec(entry);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function escapeMarkdownTableCell(value: unknown): string {
  return String(value ?? "")
    .replace(/[\\|]/g, (char) => `\\${char}`)
    .replace(/\r?\n/g, "<br>");
}

function renderUatAssessment(params: UatResultSaveParams, attempt: number, gateVerdict: "pass" | "flag"): string {
  const lines = [
    "---",
    `sliceId: ${params.sliceId}`,
    `uatType: ${params.uatType}`,
    `verdict: ${params.verdict}`,
    `attempt: ${attempt}`,
    `date: ${new Date().toISOString()}`,
    "---",
    "",
    `# UAT Result - ${params.sliceId}`,
    "",
    "## Checks",
    "",
    "| Check | Mode | Result | Evidence | Notes |",
    "|-------|------|--------|----------|-------|",
    ...params.checks.map((check) => {
      const evidence = (check.evidence ?? []).map((entry) => `${entry.kind}:${entry.ref}`).join("<br>") || "-";
      return `| ${escapeMarkdownTableCell(check.description)} | ${escapeMarkdownTableCell(check.mode)} | ${escapeMarkdownTableCell(check.result)} | ${escapeMarkdownTableCell(evidence)} | ${escapeMarkdownTableCell(check.notes)} |`;
    }),
    "",
    "## Overall Verdict",
    "",
    `${params.verdict} - ${params.notes ?? "UAT result saved."}`,
    "",
    "## Tool Presentation",
    "",
    "```json",
    JSON.stringify(params.presentation, null, 2),
    "```",
    "",
    "## Gate",
    "",
    `Aggregate UAT gate saved as ${gateVerdict}.`,
  ];
  return `${lines.join("\n")}\n`;
}

async function saveUatAttemptArtifact(basePath: string, params: UatResultSaveParams, attempt: number): Promise<string> {
  const contract = resolveGsdPathContract(basePath);
  const relativePath = `uat/${params.milestoneId}/${params.sliceId}/attempt-${attempt}.json`;
  await saveFile(join(contract.projectGsd, relativePath), `${JSON.stringify({ ...params, attempt }, null, 2)}\n`);
  return relativePath;
}

export async function executeUatResultSave(
  params: UatResultSaveParams,
  basePath: string = process.cwd(),
): Promise<ToolExecutionResult> {
  const dbAvailable = await ensureDbOpen(basePath);
  if (!dbAvailable) return errorResult("save_uat_result", "GSD database is not available.", "db_unavailable");

  const requiredError = ensureUatRequiredFields(params);
  if (requiredError) return errorResult("save_uat_result", requiredError, "invalid_params");
  const presentationError = validateCanonicalPresentation(params);
  if (presentationError) return errorResult("save_uat_result", presentationError, "alias_tool_name");
  const checkError = validateUatChecks(basePath, params);
  if (checkError) return errorResult("save_uat_result", checkError, "invalid_evidence");
  const modeError = validateUatMode(params);
  if (modeError) return errorResult("save_uat_result", modeError, "uat_mode_mismatch");

  try {
    const attempt = params.attempt === "auto" || params.attempt === undefined
      ? nextUatAttempt(basePath, params.milestoneId, params.sliceId)
      : typeof params.attempt === "string"
        ? Number.parseInt(params.attempt, 10)
        : params.attempt;
    if (!Number.isInteger(attempt) || attempt < 1) {
      return errorResult("save_uat_result", "attempt must be a positive integer or auto", "invalid_attempt");
    }
    const gateVerdict = params.verdict === "PASS" ? "pass" : "flag";
    const rationale = params.notes ?? `UAT ${params.verdict} for ${params.sliceId}.`;
    const assessment = renderUatAssessment(params, attempt, gateVerdict);
    const summary = await executeSummarySave(
      {
        milestone_id: params.milestoneId,
        slice_id: params.sliceId,
        artifact_type: "ASSESSMENT",
        content: assessment,
      },
      basePath,
    );
    if (summary.isError) return summary;
    const attemptPath = await saveUatAttemptArtifact(basePath, params, attempt);
    const evaluatedAt = new Date().toISOString();
    upsertQualityGate({
      milestoneId: params.milestoneId,
      sliceId: params.sliceId,
      gateId: "UAT",
      scope: "slice",
      taskId: "",
      status: "complete",
      verdict: gateVerdict,
      rationale,
      findings: assessment,
      evaluatedAt,
    });
    insertGateRun({
      traceId: `uat:${params.milestoneId}:${params.sliceId}`,
      turnId: `uat:${params.sliceId}:attempt-${attempt}`,
      gateId: "UAT",
      gateType: "uat",
      unitType: "run-uat",
      unitId: `run-uat:${params.milestoneId}/${params.sliceId}`,
      milestoneId: params.milestoneId,
      sliceId: params.sliceId,
      outcome: params.verdict === "PASS" ? "pass" : "fail",
      failureClass: params.verdict === "PASS" ? "none" : "verification",
      rationale,
      findings: assessment,
      attempt,
      maxAttempts: attempt,
      retryable: params.verdict !== "PASS",
      evaluatedAt,
    });
    invalidateStateCache();
    return {
      content: [{ type: "text", text: `UAT result saved for ${params.milestoneId}/${params.sliceId}: ${params.verdict}` }],
      details: {
        operation: "save_uat_result",
        milestoneId: params.milestoneId,
        sliceId: params.sliceId,
        verdict: params.verdict,
        gateVerdict,
        attempt,
        attemptPath,
        recommendedNextUnit: params.verdict === "PASS" ? null : "reactive-execute",
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("tool", `gsd_uat_result_save failed: ${msg}`, { tool: "gsd_uat_result_save", error: String(err) });
    return errorResult("save_uat_result", `saving UAT result failed: ${msg}`, msg);
  }
}

export async function executePlanMilestone(
  params: PlanMilestoneExecutorParams,
  basePath: string = process.cwd(),
): Promise<ToolExecutionResult> {
  const dbAvailable = await ensureDbOpen(basePath);
  if (!dbAvailable) {
    return {
      content: [{ type: "text", text: "Error: GSD database is not available. Cannot plan milestone." }],
      details: { operation: "plan_milestone", error: "db_unavailable" },
    isError: true,
      };
  }
  try {
    const result = await handlePlanMilestone(params, basePath);
    if ("error" in result) {
      return {
        content: [{ type: "text", text: `Error planning milestone: ${result.error}` }],
        details: { operation: "plan_milestone", error: result.error },
      isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `Planned milestone ${result.milestoneId}` }],
      details: {
        operation: "plan_milestone",
        milestoneId: result.milestoneId,
        roadmapPath: result.roadmapPath,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("tool", `plan_milestone tool failed: ${msg}`, { tool: "gsd_plan_milestone", error: String(err) });
    return {
      content: [{ type: "text", text: `Error planning milestone: ${msg}` }],
      details: { operation: "plan_milestone", error: msg },
    isError: true,
      };
  }
}

export async function executePlanSlice(
  params: PlanSliceExecutorParams,
  basePath: string = process.cwd(),
): Promise<ToolExecutionResult> {
  const dbAvailable = await ensureDbOpen(basePath);
  if (!dbAvailable) {
    return {
      content: [{ type: "text", text: "Error: GSD database is not available. Cannot plan slice." }],
      details: { operation: "plan_slice", error: "db_unavailable" },
    isError: true,
      };
  }
  try {
    const result = await handlePlanSlice(params, basePath);
    if ("error" in result) {
      return {
        content: [{ type: "text", text: `Error planning slice: ${result.error}` }],
        details: { operation: "plan_slice", error: result.error },
      isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `Planned slice ${result.sliceId} (${result.milestoneId})` }],
      details: {
        operation: "plan_slice",
        milestoneId: result.milestoneId,
        sliceId: result.sliceId,
        planPath: result.planPath,
        taskPlanPaths: result.taskPlanPaths,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("tool", `plan_slice tool failed: ${msg}`, { tool: "gsd_plan_slice", error: String(err) });
    return {
      content: [{ type: "text", text: `Error planning slice: ${msg}` }],
      details: { operation: "plan_slice", error: msg },
    isError: true,
      };
  }
}

export async function executeReplanSlice(
  params: ReplanSliceExecutorParams,
  basePath: string = process.cwd(),
): Promise<ToolExecutionResult> {
  const dbAvailable = await ensureDbOpen(basePath);
  if (!dbAvailable) {
    return {
      content: [{ type: "text", text: "Error: GSD database is not available. Cannot replan slice." }],
      details: { operation: "replan_slice", error: "db_unavailable" },
    isError: true,
      };
  }
  try {
    const result = await handleReplanSlice(params, basePath);
    if ("error" in result) {
      return {
        content: [{ type: "text", text: `Error replanning slice: ${result.error}` }],
        details: { operation: "replan_slice", error: result.error },
      isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `Replanned slice ${result.sliceId} (${result.milestoneId})` }],
      details: {
        operation: "replan_slice",
        milestoneId: result.milestoneId,
        sliceId: result.sliceId,
        replanPath: result.replanPath,
        planPath: result.planPath,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("tool", `replan_slice tool failed: ${msg}`, { tool: "gsd_replan_slice", error: String(err) });
    return {
      content: [{ type: "text", text: `Error replanning slice: ${msg}` }],
      details: { operation: "replan_slice", error: msg },
    isError: true,
      };
  }
}

export interface MilestoneStatusParams {
  milestoneId: string;
}

export async function executeMilestoneStatus(
  params: MilestoneStatusParams,
  basePath: string = process.cwd(),
): Promise<ToolExecutionResult> {
  try {
    const dbAvailable = await ensureDbOpen(basePath);
    if (!dbAvailable) {
      return {
        content: [{ type: "text", text: "Error: GSD database is not available." }],
        details: { operation: "milestone_status", error: "db_unavailable" },
      isError: true,
      };
    }

    return readTransaction(() => {
      const milestone = getMilestone(params.milestoneId);
      if (!milestone) {
        return {
          content: [{ type: "text", text: `Milestone ${params.milestoneId} not found in database.` }],
          details: { operation: "milestone_status", milestoneId: params.milestoneId, found: false },
        };
      }

      const sliceStatuses = getSliceStatusSummary(params.milestoneId);
      const slices = sliceStatuses.map((s) => ({
        id: s.id,
        status: s.status,
        taskCounts: getSliceTaskCounts(params.milestoneId, s.id),
      }));

      const result = {
        milestoneId: milestone.id,
        title: milestone.title,
        status: milestone.status,
        createdAt: milestone.created_at,
        completedAt: milestone.completed_at,
        sliceCount: slices.length,
        slices,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: { operation: "milestone_status", ...result },
      };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logWarning("tool", `gsd_milestone_status tool failed: ${msg}`);
    return {
      content: [{ type: "text", text: `Error querying milestone status: ${msg}` }],
      details: { operation: "milestone_status", error: msg },
    isError: true,
      };
  }
}

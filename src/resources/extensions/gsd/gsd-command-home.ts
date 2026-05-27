// Project/App: gsd-pi
// File Purpose: State-aware home menu for the bare /gsd command.

import type { ExtensionAPI, ExtensionCommandContext } from "@gsd/pi-coding-agent";

import { showNextAction } from "../shared/tui.js";
import type { NextAction } from "../shared/next-action-ui.js";
import { isInteractiveCommandContext } from "./command-feedback.js";
import { startAutoDetached } from "./auto.js";
import {
  loadCloseoutContext,
  runMergeMilestone,
  runMergeQuickTask,
  type CloseoutContext,
} from "./closeout-wizard.js";
import { deriveState } from "./state.js";
import type { GSDState } from "./types.js";
import type { UnmergedMilestoneBlocker } from "./unmerged-milestone-guard.js";
import {
  appendRequirementsBacklogToSummary,
  countUnmappedActiveRequirements,
  showRequirementsBacklogReview,
} from "./requirements-backlog.js";

export type GsdHomeActionId =
  | "continue_step"
  | "run_auto"
  | "review_status"
  | "review_requirements_backlog"
  | "fix_recover"
  | "finish_quick"
  | "finish_milestone"
  | "start_configure";

export interface GsdHomeAction {
  id: GsdHomeActionId;
  label: string;
  description: string;
  enabled: boolean;
  recommended?: boolean;
  disabledReason?: string;
}

export interface GsdHomeModel {
  title: string;
  summary: string[];
  actions: GsdHomeAction[];
  strandedQuick?: CloseoutContext["strandedQuick"];
  unmergedMilestone?: UnmergedMilestoneBlocker;
}

function activeWorkLabel(state: GSDState): string {
  if (state.activeTask) return `${state.activeTask.id}: ${state.activeTask.title}`;
  if (state.activeSlice) return `${state.activeSlice.id}: ${state.activeSlice.title}`;
  if (state.activeMilestone) return `${state.activeMilestone.id}: ${state.activeMilestone.title}`;
  return "No active milestone.";
}

function isBlocked(state: GSDState): boolean {
  return state.phase === "blocked" || state.blockers.length > 0;
}

function disabled(description: string, reason: string): string {
  return `Unavailable: ${reason}. ${description}`;
}

export function buildGsdHomeModel(
  state: GSDState,
  closeout?: Pick<CloseoutContext, "strandedQuick" | "unmergedMilestones">,
): GsdHomeModel {
  const blocked = isBlocked(state);
  const complete = state.phase === "complete";
  const hasActiveWork = Boolean(state.activeMilestone);
  const workLabel = activeWorkLabel(state);
  const strandedQuick = closeout?.strandedQuick ?? null;
  const unmergedMilestone = closeout?.unmergedMilestones?.[0];
  const nextReason = complete
    ? "all milestones are complete"
    : blocked
      ? "the active milestone is blocked"
      : !hasActiveWork
        ? "there is no active milestone"
        : "";

  const canAdvance = hasActiveWork && !blocked && !complete;
  const unmappedActive = complete ? countUnmappedActiveRequirements() : 0;

  const recommended: GsdHomeActionId = strandedQuick
    ? "finish_quick"
    : unmergedMilestone
      ? "finish_milestone"
      : blocked
        ? "fix_recover"
        : canAdvance
          ? "continue_step"
          : complete && unmappedActive > 0
            ? "review_requirements_backlog"
            : "start_configure";

  const completionSummary = complete
    ? appendRequirementsBacklogToSummary(state, [
        `All milestones complete${state.lastCompletedMilestone ? ` after ${state.lastCompletedMilestone.id}: ${state.lastCompletedMilestone.title}` : ""}.`,
      ])
    : [workLabel];

  const primarySummary = strandedQuick
    ? [`Quick task Q${strandedQuick.taskNum} finished on ${strandedQuick.quickBranch} but is not merged to ${strandedQuick.originalBranch}.`]
    : unmergedMilestone
      ? [`${unmergedMilestone.milestoneId} is complete but not merged into ${unmergedMilestone.integrationBranch}.`]
      : completionSummary;

  return {
    title: "GSD — What now?",
    summary: [
      ...primarySummary,
      state.nextAction && state.nextAction !== "All milestones complete." ? `Next: ${state.nextAction}` : "",
      ...state.blockers,
    ].filter(Boolean),
    strandedQuick: strandedQuick ?? undefined,
    unmergedMilestone,
    actions: [
      {
        id: "finish_quick",
        label: "Merge quick task",
        description: strandedQuick
          ? `Squash-merge ${strandedQuick.quickBranch} into ${strandedQuick.originalBranch}, then return to the integration branch.`
          : disabled("Use this when a quick-task branch still has unmerged product changes.", "no stranded quick branch"),
        enabled: Boolean(strandedQuick),
        recommended: recommended === "finish_quick",
        disabledReason: strandedQuick ? undefined : "no stranded quick branch",
      },
      {
        id: "finish_milestone",
        label: "Merge milestone",
        description: unmergedMilestone
          ? `Merge ${unmergedMilestone.milestoneId} from ${unmergedMilestone.branch} into ${unmergedMilestone.integrationBranch}.`
          : disabled("Use this when a completed milestone branch still has unmerged product changes.", "no unmerged milestone"),
        enabled: Boolean(unmergedMilestone),
        recommended: recommended === "finish_milestone",
        disabledReason: unmergedMilestone ? undefined : "no unmerged milestone",
      },
      {
        id: "continue_step",
        label: "Continue one step",
        description: canAdvance
          ? "Run the next unit, then pause on the roll-up."
          : disabled("Use this after the current state can advance.", nextReason),
        enabled: canAdvance,
        recommended: recommended === "continue_step",
        disabledReason: canAdvance ? undefined : nextReason,
      },
      {
        id: "run_auto",
        label: "Run automatically",
        description: canAdvance
          ? "Keep advancing until the milestone completes or hits a blocker."
          : disabled("Use this after the current state can advance.", nextReason),
        enabled: canAdvance,
        recommended: false,
        disabledReason: canAdvance ? undefined : nextReason,
      },
      {
        id: "review_status",
        label: "Review status",
        description: "Open the live run dashboard. For shipped work, use /gsd visualize.",
        enabled: true,
        recommended: false,
      },
      {
        id: "review_requirements_backlog",
        label: "Review requirements backlog",
        description: unmappedActive > 0
          ? `Inspect ${unmappedActive} unmapped active requirement${unmappedActive === 1 ? "" : "s"} in REQUIREMENTS.md.`
          : disabled("Use this when active requirements still need milestone ownership.", "no unmapped active requirements"),
        enabled: unmappedActive > 0,
        recommended: recommended === "review_requirements_backlog",
        disabledReason: unmappedActive > 0 ? undefined : "no unmapped active requirements",
      },
      {
        id: "fix_recover",
        label: "Fix or recover",
        description: blocked
          ? "Review the blocker and recovery commands for the active milestone."
          : disabled("This becomes active when closeout, validation, or state recovery is needed.", "no blocker is active"),
        enabled: blocked,
        recommended: recommended === "fix_recover",
        disabledReason: blocked ? undefined : "no blocker is active",
      },
      {
        id: "start_configure",
        label: "Start or configure",
        description: hasActiveWork && !complete
          ? "Open the detailed workflow menu for milestone actions, setup, or a new path."
          : "Start the next milestone, quick task, or setup path.",
        enabled: true,
        recommended: recommended === "start_configure",
      },
    ],
  };
}

function toNextAction(action: GsdHomeAction): NextAction {
  return {
    id: action.id,
    label: action.label,
    description: action.description,
    recommended: action.recommended,
  };
}

function formatHomeText(model: GsdHomeModel): string {
  const lines = [model.title, ""];
  for (const line of model.summary) lines.push(line);
  lines.push("");
  model.actions.forEach((action, index) => {
    const marker = action.recommended ? "recommended" : action.enabled ? "available" : "blocked";
    lines.push(`${index + 1}. ${action.label} (${marker})`);
    lines.push(`   ${action.description}`);
  });
  return lines.join("\n");
}

async function runStatus(ctx: ExtensionCommandContext): Promise<void> {
  const { fireStatusViaCommand } = await import("./commands.js");
  await fireStatusViaCommand(ctx);
}

async function runDetailedEntry(
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
  basePath: string,
): Promise<void> {
  const { showSmartEntry } = await import("./guided-flow.js");
  await showSmartEntry(ctx, pi, basePath, { step: true });
}

export async function showGsdHome(
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
  basePath: string,
): Promise<void> {
  const [state, closeout] = await Promise.all([
    deriveState(basePath),
    loadCloseoutContext(basePath),
  ]);
  const model = buildGsdHomeModel(state, closeout);

  if (!isInteractiveCommandContext(ctx)) {
    ctx.ui.notify(formatHomeText(model), "info");
    return;
  }

  const choice = await showNextAction(ctx, {
    title: model.title,
    summary: model.summary,
    actions: model.actions.map(toNextAction),
    notYetMessage: "Run /gsd when ready.",
  });

  if (choice === "not_yet") return;

  const selected = model.actions.find((action) => action.id === choice);
  if (!selected) return;
  if (!selected.enabled) {
    ctx.ui.notify(`${selected.label} is unavailable: ${selected.disabledReason ?? "current state cannot run it"}.`, "warning");
    return;
  }

  if (choice === "continue_step") {
    startAutoDetached(ctx, pi, basePath, false, { step: true });
    return;
  }
  if (choice === "finish_quick") {
    await runMergeQuickTask(ctx, basePath, closeout.strandedQuick);
    return;
  }
  if (choice === "finish_milestone") {
    await runMergeMilestone(ctx, basePath, closeout.unmergedMilestones[0]?.milestoneId);
    return;
  }
  if (choice === "run_auto") {
    startAutoDetached(ctx, pi, basePath, false);
    return;
  }
  if (choice === "review_status" || choice === "fix_recover") {
    await runStatus(ctx);
    return;
  }
  if (choice === "review_requirements_backlog") {
    const reviewChoice = await showRequirementsBacklogReview(ctx, basePath);
    if (reviewChoice === "new_milestone") {
      const { launchNextMilestoneDiscuss } = await import("./guided-flow.js");
      await launchNextMilestoneDiscuss(ctx, pi, basePath, true, { mapRequirementsBacklog: true });
    }
    return;
  }
  if (choice === "start_configure") {
    await runDetailedEntry(ctx, pi, basePath);
  }
}

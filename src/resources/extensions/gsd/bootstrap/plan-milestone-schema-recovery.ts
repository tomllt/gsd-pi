/**
 * Recovery for gsd_plan_milestone schema confusion (#2783 class).
 * Detects milestoneId+sliceId-only payloads (gsd_plan_slice shape) and enriches
 * validation errors + injects corrective steering with counter reset.
 */

const PLAN_MILESTONE_TOOL_NAMES = new Set(["gsd_plan_milestone", "gsd_milestone_plan"]);

export function isPlanMilestoneToolName(toolName: string): boolean {
  return PLAN_MILESTONE_TOOL_NAMES.has(toolName);
}

/**
 * True when the model passed slice-level IDs without milestone planning fields.
 */
export function isPlanMilestoneSliceIdConfusion(args: Record<string, unknown>): boolean {
  const hasMilestoneId = typeof args.milestoneId === "string" && args.milestoneId.length > 0;
  const hasSliceId = typeof args.sliceId === "string" && args.sliceId.length > 0;
  const hasTitle = typeof args.title === "string" && args.title.length > 0;
  const hasVision = typeof args.vision === "string" && args.vision.length > 0;
  const hasSlices = Array.isArray(args.slices) && args.slices.length > 0;
  return hasMilestoneId && hasSliceId && !hasTitle && !hasVision && !hasSlices;
}

const MINIMAL_PAYLOAD_EXAMPLE = `{
  "milestoneId": "M001",
  "title": "Milestone title",
  "vision": "One-sentence milestone vision.",
  "slices": [
    {
      "sliceId": "S01",
      "title": "Slice title",
      "risk": "low",
      "depends": [],
      "demo": "After this: observable demo sentence.",
      "goal": "Slice goal in one sentence."
    }
  ]
}`;

export function enrichPlanMilestoneValidationError(
  baseMessage: string,
  args: Record<string, unknown>,
): string {
  const milestoneId =
    typeof args.milestoneId === "string" ? args.milestoneId : "M001";
  return [
    baseMessage,
    "",
    "Recovery hint: you called gsd_plan_milestone with slice-level IDs only.",
    "- gsd_plan_milestone requires: milestoneId, title, vision, slices[] (each slice needs sliceId, title, risk, depends, demo, goal).",
    "- Passing only milestoneId + sliceId is the gsd_plan_slice tool shape, not milestone planning.",
    `- Retry gsd_plan_milestone for ${milestoneId} with the full roadmap payload from your Roadmap Preview.`,
    "",
    "Minimal valid shape (expand slices from your approved roadmap table):",
    MINIMAL_PAYLOAD_EXAMPLE,
  ].join("\n");
}

export function buildPlanMilestoneRecoverySteering(milestoneId: string): string {
  return [
    `gsd_plan_milestone schema recovery for ${milestoneId}.`,
    "Your last call used only milestoneId and sliceId. That is invalid for gsd_plan_milestone.",
    "Call gsd_plan_milestone now with title, vision, and the full slices[] array from the Roadmap Preview you printed.",
    "Do not call gsd_plan_slice until after the milestone roadmap is persisted.",
  ].join(" ");
}

const pendingPlanMilestoneArgs = new Map<string, Record<string, unknown>>();

function findConfusedPlanMilestoneFailure(
  failures: Array<{ toolName: string; arguments: Record<string, unknown> }>,
): { toolName: string; arguments: Record<string, unknown> } | undefined {
  return failures.find(
    (f) => isPlanMilestoneToolName(f.toolName) && isPlanMilestoneSliceIdConfusion(f.arguments),
  );
}

export function registerPlanMilestoneSchemaRecovery(pi: import("@gsd/pi-coding-agent").ExtensionAPI): void {
  pi.on("tool_format_validation_error", (event) => {
    if (!isPlanMilestoneToolName(event.toolName)) return;
    if (!isPlanMilestoneSliceIdConfusion(event.arguments)) return;
    return {
      message: enrichPlanMilestoneValidationError(event.baseMessage, event.arguments),
    };
  });

  pi.on("tool_preparation_errors_turn", (event) => {
    const confused = findConfusedPlanMilestoneFailure(event.failures);
    if (!confused) return;
    const milestoneId = String(confused.arguments.milestoneId ?? "M001");
    return {
      steeringContent: buildPlanMilestoneRecoverySteering(milestoneId),
      resetValidationFailureCap: true,
    };
  });

  pi.on("tool_execution_start", (event) => {
    if (!isPlanMilestoneToolName(event.toolName)) return;
    if (event.args && typeof event.args === "object") {
      pendingPlanMilestoneArgs.set(
        event.toolCallId,
        event.args as Record<string, unknown>,
      );
    }
  });

  pi.on("tool_execution_end", (event, ctx) => {
    const args = pendingPlanMilestoneArgs.get(event.toolCallId);
    pendingPlanMilestoneArgs.delete(event.toolCallId);
    if (!args || !event.isError || !isPlanMilestoneSliceIdConfusion(args)) return;
    const milestoneId = String(args.milestoneId ?? "M001");
    ctx.ui.notify(
      `Milestone ${milestoneId}: gsd_plan_milestone needs title, vision, and slices[]. ` +
        "See the tool error for a minimal valid payload.",
      "warning",
    );
  });
}

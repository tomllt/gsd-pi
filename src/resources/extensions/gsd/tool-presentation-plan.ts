// Project/App: gsd-pi
// File Purpose: Resolve phase-aware tool surfaces for GSD model presentations.

export type ToolPresentationSurface = "provider-tools" | "claude-code-sdk" | "mcp" | "hybrid";

export interface ToolPresentationModel {
  provider?: string;
  api?: string;
  id?: string;
}

export interface ToolPresentationPlan {
  phase: string;
  surface: ToolPresentationSurface;
  model?: ToolPresentationModel;
  allowedToolNames: string[];
  presentedToolNames: string[];
  blockedToolNames: Array<{ name: string; reason: string }>;
  aliases: Array<{ requested: string; canonical: string }>;
  diagnostics: string[];
}

export const RUN_UAT_WORKFLOW_TOOL_NAMES = [
  "gsd_uat_exec",
  "gsd_uat_result_save",
  "gsd_resume",
  "gsd_milestone_status",
  "gsd_journal_query",
] as const;

export const RUN_UAT_FORBIDDEN_TOOL_NAMES = [
  "edit",
  "write",
  "gsd_exec",
  "gsd_summary_save",
  "gsd_save_gate_result",
  "search-the-web",
  "WebSearch",
  "Bash",
  "Write",
  "Edit",
  "mcp__gsd-workflow__*",
] as const;

export const RUN_UAT_CLAUDE_NATIVE_TOOL_NAMES = [
  "Read",
  "Glob",
  "Grep",
] as const;

const WORKFLOW_ALIAS_TO_CANONICAL: Record<string, string> = {
  gsd_save_decision: "gsd_decision_save",
  gsd_update_requirement: "gsd_requirement_update",
  gsd_save_requirement: "gsd_requirement_save",
  gsd_save_summary: "gsd_summary_save",
  gsd_generate_milestone_id: "gsd_milestone_generate_id",
  gsd_milestone_plan: "gsd_plan_milestone",
  gsd_slice_plan: "gsd_plan_slice",
  gsd_task_plan: "gsd_plan_task",
  gsd_slice_replan: "gsd_replan_slice",
  gsd_complete_slice: "gsd_slice_complete",
  gsd_milestone_complete: "gsd_complete_milestone",
  gsd_milestone_validate: "gsd_validate_milestone",
  gsd_roadmap_reassess: "gsd_reassess_roadmap",
  gsd_complete_task: "gsd_task_complete",
  gsd_reopen_task: "gsd_task_reopen",
  gsd_reopen_slice: "gsd_slice_reopen",
  gsd_reopen_milestone: "gsd_milestone_reopen",
};

export function canonicalWorkflowToolName(toolName: string): string {
  const mcp = parseMcpToolName(toolName);
  const baseName = mcp?.tool ?? toolName;
  return WORKFLOW_ALIAS_TO_CANONICAL[baseName] ?? baseName;
}

export function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  if (!toolName.startsWith("mcp__")) return null;
  const toolSeparator = toolName.indexOf("__", "mcp__".length);
  if (toolSeparator < 0) return null;
  return {
    server: toolName.slice("mcp__".length, toolSeparator),
    tool: toolName.slice(toolSeparator + 2),
  };
}

export function toWorkflowMcpToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${canonicalWorkflowToolName(toolName)}`;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function addBlockedTool(
  blocked: ToolPresentationPlan["blockedToolNames"],
  name: string,
  reason: string,
): void {
  if (!blocked.some((entry) => entry.name === name)) {
    blocked.push({ name, reason });
  }
}

export function buildRunUatCanonicalToolNames(options: { includeBrowserTools?: readonly string[] } = {}): string[] {
  return dedupe([
    ...RUN_UAT_WORKFLOW_TOOL_NAMES,
    ...(options.includeBrowserTools ?? []),
  ]);
}

export function resolveToolPresentationPlan(options: {
  phase: string;
  surface: ToolPresentationSurface;
  model?: ToolPresentationModel;
  workflowMcpServerName?: string | null;
  requestedToolNames?: readonly string[];
  availableToolNames?: readonly string[];
  includeBrowserTools?: readonly string[];
}): ToolPresentationPlan {
  const requested = options.requestedToolNames ?? (
    options.phase === "run-uat"
      ? buildRunUatCanonicalToolNames({ includeBrowserTools: options.includeBrowserTools })
      : []
  );
  const available = new Set(options.availableToolNames ?? requested);
  const aliases: ToolPresentationPlan["aliases"] = [];
  const blockedToolNames: ToolPresentationPlan["blockedToolNames"] = [];
  const allowed: string[] = [];

  for (const name of requested) {
    const canonical = canonicalWorkflowToolName(name);
    if (canonical !== name) aliases.push({ requested: name, canonical });
    if (!available.has(name) && !available.has(canonical)) {
      addBlockedTool(blockedToolNames, canonical, "not registered or provider-incompatible");
      continue;
    }
    allowed.push(canonical);
  }

  const allowedToolNames = dedupe(allowed);
  const workflowServerName = options.workflowMcpServerName || "gsd-workflow";
  const presentedToolNames = options.surface === "claude-code-sdk" || options.surface === "mcp"
    ? allowedToolNames.map((name) =>
        name.startsWith("gsd_") || name === "ask_user_questions"
          ? toWorkflowMcpToolName(workflowServerName, name)
          : name
      )
    : allowedToolNames;

  if (options.phase === "run-uat") {
    for (const forbidden of RUN_UAT_FORBIDDEN_TOOL_NAMES) {
      addBlockedTool(blockedToolNames, forbidden, "forbidden during run-uat");
    }
  }

  return {
    phase: options.phase,
    surface: options.surface,
    model: options.model,
    allowedToolNames,
    presentedToolNames,
    blockedToolNames,
    aliases,
    diagnostics: [],
  };
}

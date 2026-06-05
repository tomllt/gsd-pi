// Project/App: gsd-pi
// File Purpose: Central UAT mode policy for dispatch, tool presentation, and result validation.

import { extractUatType } from "./files.js";
import type { UatType } from "./files.js";
import { hasBrowserRequiredText } from "./browser-evidence.js";

export type { UatType } from "./files.js";

export type UatVerdict = "PASS" | "FAIL" | "PARTIAL";
export type UatCheckResult = "PASS" | "FAIL" | "NEEDS-HUMAN";
export type UatCheckMode = "artifact" | "runtime" | "browser" | "human-follow-up";

export interface UatPolicyCheck {
  mode: UatCheckMode;
  result: UatCheckResult;
  nonAutomatable?: boolean;
}

export interface UatModePolicy {
  browserTools: boolean;
  partialEligible: boolean;
  passWithHumanFollowUp: boolean;
  requiredAnyModes: readonly UatCheckMode[];
}

export interface UatContentPolicy {
  declaredType: UatType;
  effectiveType: UatType;
  browserRequired: boolean;
  shouldDispatchByDefault: boolean;
}

export const UAT_TYPES: readonly UatType[] = [
  "artifact-driven",
  "browser-executable",
  "runtime-executable",
  "live-runtime",
  "mixed",
  "human-experience",
] as const;

export const UAT_MODE_POLICIES: Readonly<Record<UatType, UatModePolicy>> = {
  "artifact-driven": {
    browserTools: false,
    partialEligible: false,
    passWithHumanFollowUp: false,
    requiredAnyModes: [],
  },
  "browser-executable": {
    browserTools: true,
    partialEligible: false,
    passWithHumanFollowUp: false,
    requiredAnyModes: ["browser"],
  },
  "runtime-executable": {
    browserTools: false,
    partialEligible: false,
    passWithHumanFollowUp: false,
    requiredAnyModes: ["runtime"],
  },
  "live-runtime": {
    browserTools: true,
    partialEligible: true,
    passWithHumanFollowUp: true,
    requiredAnyModes: ["runtime", "browser"],
  },
  mixed: {
    browserTools: true,
    partialEligible: true,
    passWithHumanFollowUp: true,
    requiredAnyModes: [],
  },
  "human-experience": {
    browserTools: true,
    partialEligible: true,
    passWithHumanFollowUp: true,
    requiredAnyModes: [],
  },
};

export function isUatType(value: unknown): value is UatType {
  return typeof value === "string" && (UAT_TYPES as readonly string[]).includes(value);
}

export function getDeclaredUatType(content: string): UatType {
  return extractUatType(content) ?? "artifact-driven";
}

export function classifyUatContent(content: string): UatContentPolicy {
  const declaredType = getDeclaredUatType(content);
  const browserRequired = hasBrowserRequiredText(content);
  const effectiveType = declaredType === "artifact-driven" && browserRequired
    ? "browser-executable"
    : declaredType;

  return {
    declaredType,
    effectiveType,
    browserRequired,
    shouldDispatchByDefault: effectiveType !== "artifact-driven" || browserRequired,
  };
}

export function shouldEscalateArtifactUatToBrowser(content: string): boolean {
  const policy = classifyUatContent(content);
  return policy.declaredType === "artifact-driven" && policy.browserRequired;
}

export function resolveEffectiveUatType(content: string): UatType {
  return classifyUatContent(content).effectiveType;
}

export function shouldDispatchUatForContent(
  content: string,
  prefs: { uat_dispatch?: boolean } | undefined,
): boolean {
  return !!prefs?.uat_dispatch || classifyUatContent(content).shouldDispatchByDefault;
}

export function uatTypeIncludesBrowser(uatType: string | undefined): boolean {
  return isUatType(uatType) && UAT_MODE_POLICIES[uatType].browserTools;
}

function canonicalPresentedToolName(toolName: string): string {
  if (!toolName.startsWith("mcp__")) return toolName;
  const toolSeparator = toolName.indexOf("__", "mcp__".length);
  return toolSeparator >= 0 ? toolName.slice(toolSeparator + 2) : toolName;
}

export function isUatBrowserToolName(toolName: string): boolean {
  return canonicalPresentedToolName(toolName).startsWith("browser_");
}

export function hasUatBrowserToolSurface(activeTools: readonly string[] | undefined): boolean {
  return Array.isArray(activeTools) && activeTools.some(isUatBrowserToolName);
}

export function getUatBrowserToolSupportError(options: {
  uatType: UatType;
  activeTools: readonly string[] | undefined;
  milestoneId: string;
  sliceId: string;
}): string | null {
  if (!uatTypeIncludesBrowser(options.uatType)) return null;
  if (!Array.isArray(options.activeTools)) return null;
  if (hasUatBrowserToolSurface(options.activeTools)) return null;

  return `Cannot dispatch browser-backed run-uat for ${options.milestoneId}/${options.sliceId}: UAT mode "${options.uatType}" requires browser tools, but the active tool surface has none. Enable browser tools or change the UAT to a runtime-executable Playwright command, then rerun /gsd auto.`;
}

export function isPartialEligibleUatType(uatType: UatType | undefined): boolean {
  return !!uatType && UAT_MODE_POLICIES[uatType].partialEligible;
}

function modeList(modes: readonly UatCheckMode[]): string {
  if (modes.length === 1) return modes[0]!;
  return modes.slice(0, -1).join(", ") + " or " + modes[modes.length - 1]!;
}

export function validateUatModePolicy(params: {
  uatType: UatType;
  verdict: UatVerdict;
  checks: readonly UatPolicyCheck[];
}): string | null {
  const policy = UAT_MODE_POLICIES[params.uatType];
  const modes = new Set(params.checks.map((check) => check.mode));
  const hasHuman = params.checks.some((check) => check.result === "NEEDS-HUMAN");

  if (params.uatType === "artifact-driven" && hasHuman && params.verdict === "PASS") {
    return "artifact-driven UAT cannot PASS with human-only checks";
  }

  if (
    hasHuman &&
    params.verdict === "PASS" &&
    !policy.passWithHumanFollowUp &&
    !params.checks.every((check) => check.result !== "NEEDS-HUMAN" || check.nonAutomatable === true)
  ) {
    return "NEEDS-HUMAN checks can only coexist with PASS for human-experience, mixed, live-runtime, or explicitly non-automatable checks";
  }

  if (
    policy.requiredAnyModes.length > 0 &&
    !policy.requiredAnyModes.some((mode) => modes.has(mode))
  ) {
    return `${params.uatType} UAT requires ${modeList(policy.requiredAnyModes)} evidence`;
  }

  return null;
}

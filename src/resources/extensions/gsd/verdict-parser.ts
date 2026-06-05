/**
 * Centralized verdict extraction, normalization, and schema validation.
 *
 * All verdict-related logic lives here so that normalization rules
 * (e.g. `passed` → `pass`) are applied consistently across the codebase.
 */

import { splitFrontmatter, parseFrontmatterMap } from "../shared/frontmatter.js";
import { parse as parseYaml } from "yaml";
import { getDeclaredUatType, isPartialEligibleUatType, type UatType } from "./uat-policy.js";

function normalizeVerdict(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  let verdict = value.trim().toLowerCase();
  if (!verdict) return undefined;
  if (verdict === "passed") verdict = "pass";
  return verdict;
}

function getCaseInsensitive(obj: Record<string, unknown>, key: string): unknown {
  const lowerKey = key.toLowerCase();
  for (const [candidate, value] of Object.entries(obj)) {
    if (candidate.toLowerCase() === lowerKey) return value;
  }
  return undefined;
}

// ── Verdict extraction ──────────────────────────────────────────────────

/**
 * Extract and normalize the frontmatter `verdict` value.
 *
 * Supports both top-level `verdict` and the hook outcome shape
 * `outcome.verdict`. Returns `undefined` when frontmatter is absent or has no
 * verdict field.
 */
export function extractFrontmatterVerdict(content: string): string | undefined {
  const [frontmatterLines] = splitFrontmatter(content);
  if (!frontmatterLines) return undefined;

  try {
    const parsed = parseYaml(frontmatterLines.join("\n")) as unknown;
    if (parsed && typeof parsed === "object") {
      const root = parsed as Record<string, unknown>;
      const topLevel = normalizeVerdict(getCaseInsensitive(root, "verdict"));
      if (topLevel) return topLevel;
      const outcome = getCaseInsensitive(root, "outcome");
      if (outcome && typeof outcome === "object") {
        const nested = normalizeVerdict(getCaseInsensitive(outcome as Record<string, unknown>, "verdict"));
        if (nested) return nested;
      }
    }
  } catch {
    // Fall through to the permissive parser used by legacy frontmatter paths.
  }

  const frontmatter = parseFrontmatterMap(frontmatterLines);
  const topLevel = normalizeVerdict(getCaseInsensitive(frontmatter, "verdict"));
  if (topLevel) return topLevel;
  return undefined;
}

/**
 * Extract and normalize the `verdict` value from YAML frontmatter.
 *
 * Normalization:
 * - lowercased
 * - `passed` → `pass`
 *
 * Returns `undefined` when frontmatter is absent or has no `verdict` field.
 */
export function extractVerdict(content: string): string | undefined {
  // Primary: YAML frontmatter verdict (canonical format)
  const [frontmatterLines] = splitFrontmatter(content);
  if (frontmatterLines) return extractFrontmatterVerdict(content);

  // Fallback: detect verdict in markdown body (LLM manual writes, #2960).
  // Matches patterns like: **Verdict:** PASS, **Verdict:** ✅ PASS, **Verdict** needs-remediation
  const bodyMatch = content.match(/\*\*Verdict:?\*\*\s*(?:✅\s*)?(\w[\w-]*)/i);
  if (bodyMatch) {
    return normalizeVerdict(bodyMatch[1]);
  }

  return undefined;
}

/**
 * Returns `true` when the content's frontmatter contains a `verdict` field.
 */
export function hasVerdict(content: string): boolean {
  return /verdict:\s*[\w-]+/i.test(content);
}

// ── UAT verdict schema ──────────────────────────────────────────────────

/**
 * Base verdicts that are always acceptable for UAT results.
 */
export const UAT_ACCEPTABLE_VERDICTS: readonly string[] = ["pass", "passed"];

/**
 * UAT types whose results may legitimately produce a `partial` verdict
 * when all automatable checks pass but human-only checks remain.
 */
/**
 * Check whether a verdict is acceptable for a given UAT type.
 *
 * `pass` / `passed` are always acceptable. `partial` is acceptable only for
 * UAT types that include non-automatable human checks.
 */
export function isAcceptableUatVerdict(verdict: string, uatType: UatType | undefined): boolean {
  if (UAT_ACCEPTABLE_VERDICTS.includes(verdict)) return true;
  if (verdict === "partial" && isPartialEligibleUatType(uatType)) {
    return true;
  }
  return false;
}

// ── Milestone validation verdict schema ─────────────────────────────────

/**
 * Valid verdicts for the `validate-milestone` tool.
 */
export const VALIDATION_VERDICTS = ["pass", "needs-attention", "needs-remediation"] as const;
export type ValidationVerdict = (typeof VALIDATION_VERDICTS)[number];

/**
 * Check whether a string is a valid milestone validation verdict.
 */
export function isValidMilestoneVerdict(verdict: string): verdict is ValidationVerdict {
  return (VALIDATION_VERDICTS as readonly string[]).includes(verdict);
}

// ── UAT type helper ─────────────────────────────────────────────────────

/**
 * Extract the UAT type from content, defaulting to `"artifact-driven"`.
 *
 * The `"artifact-driven"` fallback is the original default used throughout
 * the codebase when a UAT file lacks an explicit `## UAT Type` section.
 */
export function getUatType(content: string): UatType {
  return getDeclaredUatType(content);
}

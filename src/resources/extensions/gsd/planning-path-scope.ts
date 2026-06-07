import { isAbsolute, relative, resolve } from "node:path";
import { normalizePlannedFileReference } from "./files.js";
import { shouldValidatePlanningPathReference } from "./pre-execution-checks.js";

export interface PlanningPathScopeField {
  field: string;
  values: string[];
}

function isInsideBase(basePath: string, candidate: string): boolean {
  const base = resolve(basePath);
  const abs = resolve(candidate);
  const rel = relative(base, abs);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

function isInsideAnyBase(bases: string[], candidate: string): boolean {
  return bases.some((base) => isInsideBase(base, candidate));
}

function resolvesInsideRoot(root: string, candidate: string): boolean {
  const resolvedCandidate = isAbsolute(candidate)
    ? resolve(candidate)
    : resolve(root, candidate);
  return isInsideBase(root, resolvedCandidate);
}

/**
 * Planning IO fields are execution contracts. Absolute paths are only safe when
 * they stay inside the active working directory; in worktree mode, an absolute
 * path to the original checkout makes executors edit the wrong tree.
 */
export function validatePlanningPathScope(
  basePath: string,
  fields: PlanningPathScopeField[],
  allowedAbsoluteRoots?: string[],
): string | null {
  const absoluteRoots = (allowedAbsoluteRoots && allowedAbsoluteRoots.length > 0)
    ? allowedAbsoluteRoots
    : [basePath];
  for (const { field, values } of fields) {
    for (const raw of values) {
      const trimmed = raw.trim();
      if (!shouldValidatePlanningPathReference(trimmed)) continue;

      const candidate = normalizePlannedFileReference(raw);
      if (isAbsolute(candidate)) {
        if (isInsideAnyBase(absoluteRoots, resolve(candidate))) continue;
      } else if (absoluteRoots.some((root) => resolvesInsideRoot(root, candidate))) {
        continue;
      }
      return `${field} contains path outside allowed repository roots: ${candidate}. Use a path within one of: ${absoluteRoots.join(", ")}.`;
    }
  }

  return null;
}

export function validatePathOnlyPlanningFields(fields: PlanningPathScopeField[]): string | null {
  for (const { field, values } of fields) {
    for (const raw of values) {
      if (shouldValidatePlanningPathReference(raw)) continue;
      return `${field} must contain only file paths; invalid entry: ${raw}`;
    }
  }
  return null;
}

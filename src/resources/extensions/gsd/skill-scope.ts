/**
 * Per-unit skill catalog scoping for GSD auto and workflow dispatch.
 */

import type { ExtensionAPI } from "@gsd/pi-coding-agent";

import { resolveSkillManifest } from "./skill-manifest.js";
import { normalizeSkillName } from "./skills.js";

/** Whether this unit type has a manifest allowlist (not wildcard). */
export function unitHasSkillManifest(unitType: string | undefined): boolean {
  return resolveSkillManifest(unitType) !== null;
}

/** Apply manifest-scoped or full skill catalog visibility for a unit type. */
export function applyUnitSkillVisibility(
  pi: Pick<ExtensionAPI, "setVisibleSkills">,
  unitType: string | undefined,
): void {
  const manifest = resolveSkillManifest(unitType);
  pi.setVisibleSkills(manifest ?? undefined);
}

/** Installed skill names visible for a unit (manifest-filtered when applicable). */
export function effectiveSkillNamesForUnit(
  unitType: string | undefined,
  installed: string[],
): string[] {
  const manifest = resolveSkillManifest(unitType);
  if (manifest === null) return installed;
  const allowed = new Set(manifest);
  return installed.filter((name) => allowed.has(normalizeSkillName(name)));
}

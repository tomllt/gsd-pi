/**
 * GSD Skill Discovery
 *
 * Detects skills installed during auto-mode by comparing the current
 * installed catalog against a snapshot taken at auto-mode start.
 *
 * New skills are surfaced via resource reload (see system-context) so they
 * appear in the standard `<available_skills>` catalog.
 */

import { getInstalledSkills, normalizeSkillName, snapshotInstalledSkillNames } from "./skills.js";

export interface DiscoveredSkill {
  name: string;
  description: string;
  location: string;
}

/** Snapshot of normalized skill names at auto-mode start */
let baselineSkills: Set<string> | null = null;

/**
 * Snapshot the current installed skill catalog. Call at auto-mode start.
 */
export function snapshotSkills(): void {
  baselineSkills = snapshotInstalledSkillNames();
}

/**
 * Clear the snapshot. Call when auto-mode stops.
 */
export function clearSkillSnapshot(): void {
  baselineSkills = null;
}

/**
 * Check if a snapshot is active (auto-mode is running with discovery).
 */
export function hasSkillSnapshot(): boolean {
  return baselineSkills !== null;
}

/**
 * Detect skills installed since the snapshot was taken.
 * Returns skill metadata for any new skills found in the loader catalog.
 */
export function detectNewSkills(): DiscoveredSkill[] {
  if (!baselineSkills) return [];

  const newSkills: DiscoveredSkill[] = [];
  for (const skill of getInstalledSkills()) {
    const normalized = normalizeSkillName(skill.name);
    if (baselineSkills.has(normalized)) continue;
    newSkills.push({
      name: skill.name,
      description: skill.description || `Skill: ${skill.name}`,
      location: skill.filePath,
    });
  }

  return newSkills;
}

/**
 * Reload the skill catalog when auto-mode detects newly installed skills.
 * Updates the snapshot baseline after reload so detection is one-shot per install.
 */
export async function refreshCatalogForNewSkills(options?: {
  reload?: () => Promise<void>;
  notify?: (message: string, level: "info" | "warning") => void;
}): Promise<DiscoveredSkill[]> {
  const newSkills = detectNewSkills();
  if (newSkills.length === 0) return [];

  if (options?.reload) {
    try {
      await options.reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.notify?.(`GSD: failed to reload skill catalog: ${message}`, "warning");
    }
  }

  snapshotSkills();
  const names = newSkills.map((skill) => skill.name).join(", ");
  options?.notify?.(`GSD: loaded new skills: ${names}`, "info");
  return newSkills;
}

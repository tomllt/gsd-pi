import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import {
  gsdProjectionRoot,
  gsdRoot,
  milestonesDir,
  resolveSliceFile,
  resolveTaskFile,
  _clearGsdRootCache,
} from "../../paths.ts";
/** Create a tmp dir and resolve symlinks + 8.3 short names (macOS /var→/private/var, Windows RUNNER~1→runneradmin). */
function tmp(): string {
  const p = mkdtempSync(join(tmpdir(), "gsd-paths-test-"));
  try { return realpathSync.native(p); } catch { return p; }
}

function cleanup(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function initGit(dir: string): void {
  spawnSync("git", ["init"], { cwd: dir });
  spawnSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: dir });
}

describe('paths', () => {
  test('Case 1: .gsd exists at basePath — fast path', () => {
    const root = tmp();
    try {
      mkdirSync(join(root, ".gsd"));
      _clearGsdRootCache();
      const result = gsdRoot(root);
      assert.deepStrictEqual(result, join(root, ".gsd"), "fast path: returns basePath/.gsd");
    } finally { cleanup(root); }
  });

  test('Case 2: .gsd exists at git root, cwd is a subdirectory', () => {
    const root = tmp();
    try {
      initGit(root);
      mkdirSync(join(root, ".gsd"));
      const sub = join(root, "src", "deep");
      mkdirSync(sub, { recursive: true });
      _clearGsdRootCache();
      const result = gsdRoot(sub);
      assert.deepStrictEqual(result, join(root, ".gsd"), "git-root probe: finds .gsd at git root from subdirectory");
    } finally { cleanup(root); }
  });

  test('Case 3: .gsd in an ancestor — walk-up finds it', () => {
    const root = tmp();
    try {
      initGit(root);
      const project = join(root, "project");
      mkdirSync(join(project, ".gsd"), { recursive: true });
      const deep = join(project, "src", "deep");
      mkdirSync(deep, { recursive: true });
      _clearGsdRootCache();
      const result = gsdRoot(deep);
      assert.deepStrictEqual(result, join(project, ".gsd"), "walk-up: finds .gsd in ancestor when git root has none");
    } finally { cleanup(root); }
  });

  test('Case 4: .gsd nowhere — fallback returns original basePath/.gsd', () => {
    const root = tmp();
    try {
      initGit(root);
      const sub = join(root, "src");
      mkdirSync(sub, { recursive: true });
      _clearGsdRootCache();
      const result = gsdRoot(sub);
      assert.deepStrictEqual(result, join(sub, ".gsd"), "fallback: returns basePath/.gsd when .gsd not found anywhere");
    } finally { cleanup(root); }
  });

  test('Case 5: cache — second call returns same value without re-probing', () => {
    const root = tmp();
    try {
      mkdirSync(join(root, ".gsd"));
      _clearGsdRootCache();
      const first = gsdRoot(root);
      const second = gsdRoot(root);
      assert.deepStrictEqual(first, second, "cache: same result returned on second call");
      assert.ok(first === second, "cache: identity check (same string)");
    } finally { cleanup(root); }
  });

  test('Case 6: .gsd at basePath takes precedence over ancestor .gsd', () => {
    const outer = tmp();
    try {
      initGit(outer);
      mkdirSync(join(outer, ".gsd"));
      const inner = join(outer, "nested");
      mkdirSync(join(inner, ".gsd"), { recursive: true });
      _clearGsdRootCache();
      const result = gsdRoot(inner);
      assert.deepStrictEqual(result, join(inner, ".gsd"), "precedence: nearest .gsd wins over ancestor");
    } finally { cleanup(outer); }
  });

  test('Case 7: milestone artifact readers use worktree projection root', () => {
    const root = tmp();
    try {
      initGit(root);
      const projectGsd = join(root, ".gsd");
      mkdirSync(projectGsd);
      const wtRoot = join(projectGsd, "worktrees", "M001");
      const wtGsd = join(wtRoot, ".gsd");
      const tasksDir = join(wtGsd, "milestones", "M001", "slices", "S01", "tasks");
      mkdirSync(tasksDir, { recursive: true });
      writeFileSync(join(wtRoot, ".git"), `gitdir: ${join(root, ".git")}\n`, "utf-8");
      writeFileSync(join(wtGsd, "milestones", "M001", "slices", "S01", "S01-PLAN.md"), "# slice plan\n");
      writeFileSync(join(tasksDir, "T01-PLAN.md"), "# task plan\n");

      _clearGsdRootCache();

      assert.deepStrictEqual(gsdRoot(wtRoot), projectGsd, "runtime/control root stays project .gsd");
      assert.deepStrictEqual(gsdProjectionRoot(wtRoot), wtGsd, "projection root is worktree .gsd");
      assert.deepStrictEqual(milestonesDir(wtRoot), join(wtGsd, "milestones"));
      assert.deepStrictEqual(
        resolveSliceFile(wtRoot, "M001", "S01", "PLAN"),
        join(wtGsd, "milestones", "M001", "slices", "S01", "S01-PLAN.md"),
      );
      assert.deepStrictEqual(
        resolveTaskFile(wtRoot, "M001", "S01", "T01", "PLAN"),
        join(tasksDir, "T01-PLAN.md"),
      );
    } finally { cleanup(root); }
  });

  test('Case 8: external-state worktree milestone readers use projection root', () => {
    const root = tmp();
    const originalStateDir = process.env.GSD_STATE_DIR;
    try {
      const stateDir = join(root, "state");
      process.env.GSD_STATE_DIR = stateDir;
      const projectGsd = join(stateDir, "projects", "abc123");
      const wtRoot = join(projectGsd, "worktrees", "M002");
      const wtGsd = join(wtRoot, ".gsd");
      const tasksDir = join(wtGsd, "milestones", "M002", "slices", "S01", "tasks");
      mkdirSync(tasksDir, { recursive: true });
      writeFileSync(join(wtGsd, "milestones", "M002", "slices", "S01", "S01-PLAN.md"), "# slice plan\n");
      writeFileSync(join(tasksDir, "T01-PLAN.md"), "# task plan\n");

      _clearGsdRootCache();

      assert.deepStrictEqual(gsdRoot(wtRoot), projectGsd, "external-state control root stays project store");
      assert.deepStrictEqual(gsdProjectionRoot(wtRoot), wtGsd, "external-state projection root is worktree .gsd");
      assert.deepStrictEqual(milestonesDir(wtRoot), join(wtGsd, "milestones"));
      assert.deepStrictEqual(
        resolveSliceFile(wtRoot, "M002", "S01", "PLAN"),
        join(wtGsd, "milestones", "M002", "slices", "S01", "S01-PLAN.md"),
      );
      assert.deepStrictEqual(
        resolveTaskFile(wtRoot, "M002", "S01", "T01", "PLAN"),
        join(tasksDir, "T01-PLAN.md"),
      );
    } finally {
      if (originalStateDir === undefined) delete process.env.GSD_STATE_DIR;
      else process.env.GSD_STATE_DIR = originalStateDir;
      cleanup(root);
    }
  });
});

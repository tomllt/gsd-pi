// Project/App: gsd-pi
// File Purpose: Worktree State Projection Module — typed-Interface contract tests for projectRootToWorktree (ADR-016).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorktreeStateProjection } from "../worktree-state-projection.js";
import { createWorkspace, scopeMilestone } from "../workspace.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProjectRoot(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "gsd-projection-"));
  // .gsd directory is required for the workspace contract resolution
  mkdirSync(join(dir, ".gsd"), { recursive: true });
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// ─── projectRootToWorktree — Module contract ────────────────────────────────

test("WorktreeStateProjection can be constructed without arguments", () => {
  const projection = new WorktreeStateProjection();
  assert.ok(projection);
  assert.equal(typeof projection.projectRootToWorktree, "function");
});

test("projectRootToWorktree accepts a MilestoneScope without throwing on same-path scope", () => {
  const { dir, cleanup } = makeProjectRoot();
  try {
    const workspace = createWorkspace(dir);
    const scope = scopeMilestone(workspace, "M001");
    const projection = new WorktreeStateProjection();

    // When the scope's workspace has no worktreeRoot (project-only mode),
    // the underlying syncProjectRootToWorktree fast-paths to a no-op when
    // both endpoints resolve to the same path. The Module must accept
    // this scope and complete silently.
    assert.doesNotThrow(() => projection.projectRootToWorktree(scope));
  } finally {
    cleanup();
  }
});

test("projectRootToWorktree is idempotent — repeated calls do not throw", () => {
  const { dir, cleanup } = makeProjectRoot();
  try {
    const workspace = createWorkspace(dir);
    const scope = scopeMilestone(workspace, "M001");
    const projection = new WorktreeStateProjection();

    projection.projectRootToWorktree(scope);
    projection.projectRootToWorktree(scope);
    assert.ok(true, "two calls did not throw");
  } finally {
    cleanup();
  }
});

test("projectRootToWorktree forwards root PROJECT.md into isolated worktrees", () => {
  const { dir, cleanup } = makeProjectRoot();
  try {
    const worktree = join(dir, ".gsd", "worktrees", "M001");
    mkdirSync(join(dir, ".gsd", "milestones", "M001"), { recursive: true });
    mkdirSync(join(worktree, ".gsd"), { recursive: true });

    const projectContent = [
      "# Project",
      "",
      "## Milestone Sequence",
      "",
      "- [ ] M001: Foundation — Establish the runnable slice.",
      "",
    ].join("\n");
    writeFileSync(join(dir, ".gsd", "PROJECT.md"), projectContent);
    writeFileSync(join(dir, ".gsd", "REQUIREMENTS.md"), "# Requirements\n");
    writeFileSync(join(dir, ".gsd", "milestones", "M001", "M001-ROADMAP.md"), "# M001\n");

    const workspace = createWorkspace(worktree);
    const scope = scopeMilestone(workspace, "M001");
    const projection = new WorktreeStateProjection();

    projection.projectRootToWorktree(scope);

    const projectedProject = join(worktree, ".gsd", "PROJECT.md");
    assert.ok(existsSync(projectedProject), "PROJECT.md is available to worktree-bound units");
    assert.equal(readFileSync(projectedProject, "utf-8"), projectContent);
    assert.ok(
      existsSync(join(worktree, ".gsd", "milestones", "M001", "M001-ROADMAP.md")),
      "milestone artifacts still project into the worktree",
    );
  } finally {
    cleanup();
  }
});

// ─── projectWorktreeToRoot — Module contract ────────────────────────────────

test("projectWorktreeToRoot exists and accepts a MilestoneScope", () => {
  const projection = new WorktreeStateProjection();
  assert.equal(typeof projection.projectWorktreeToRoot, "function");
});

test("projectWorktreeToRoot is non-fatal on same-path scope (project-only mode)", () => {
  const { dir, cleanup } = makeProjectRoot();
  try {
    const workspace = createWorkspace(dir);
    const scope = scopeMilestone(workspace, "M001");
    const projection = new WorktreeStateProjection();

    // Same project root on both sides — sync helper fast-paths to no-op.
    // Module must accept and complete silently.
    assert.doesNotThrow(() => projection.projectWorktreeToRoot(scope));
  } finally {
    cleanup();
  }
});

test("projectWorktreeToRoot is idempotent on repeated calls", () => {
  const { dir, cleanup } = makeProjectRoot();
  try {
    const workspace = createWorkspace(dir);
    const scope = scopeMilestone(workspace, "M001");
    const projection = new WorktreeStateProjection();

    projection.projectWorktreeToRoot(scope);
    projection.projectWorktreeToRoot(scope);
    assert.ok(true, "two calls did not throw");
  } finally {
    cleanup();
  }
});

// ─── finalizeProjectionForMerge — Module contract ────────────────────────────

test("finalizeProjectionForMerge exists and accepts a MilestoneScope", () => {
  const projection = new WorktreeStateProjection();
  assert.equal(typeof projection.finalizeProjectionForMerge, "function");
});

test("finalizeProjectionForMerge returns { synced } shape on same-path scope", () => {
  const { dir, cleanup } = makeProjectRoot();
  try {
    const workspace = createWorkspace(dir);
    const scope = scopeMilestone(workspace, "M001");
    const projection = new WorktreeStateProjection();

    // Project-only mode (no worktreeRoot) — finalize fast-paths to {synced: []}
    const result = projection.finalizeProjectionForMerge(scope);
    assert.ok(Array.isArray(result.synced));
  } finally {
    cleanup();
  }
});

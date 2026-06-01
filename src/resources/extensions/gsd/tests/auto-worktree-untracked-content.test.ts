// Project/App: gsd-pi
// File Purpose: Regression coverage for auto-worktree import of untracked root content.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAutoWorktree, teardownAutoWorktree, _resetAutoWorktreeOriginalBaseForTests } from "../auto-worktree.ts";
import { classifyProject } from "../detection.ts";

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  }).trim();
}

function makeRepoWithUntrackedSource(): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "gsd-auto-wt-untracked-")));
  runGit(["init", "-b", "main"], base);
  runGit(["config", "user.name", "Test User"], base);
  runGit(["config", "user.email", "test@example.com"], base);
  writeFileSync(join(base, ".gitignore"), ".gsd\n.DS_Store\n", "utf-8");
  runGit(["add", ".gitignore"], base);
  runGit(["commit", "-m", "chore: init gitignore"], base);
  writeFileSync(join(base, "index.html"), "<h1>Todo</h1>\n", "utf-8");
  return base;
}

test("createAutoWorktree imports untracked project-root content into empty milestone worktrees", (t) => {
  const originalCwd = process.cwd();
  const base = makeRepoWithUntrackedSource();
  t.after(() => {
    _resetAutoWorktreeOriginalBaseForTests();
    try {
      process.chdir(originalCwd);
    } catch { /* ignore deleted cwd during cleanup */ }
    rmSync(base, { recursive: true, force: true });
  });

  assert.equal(classifyProject(base).kind, "untyped-existing", "root has untracked project content");

  const wtPath = createAutoWorktree(base, "M001");

  assert.ok(existsSync(join(wtPath, "index.html")), "untracked source file is copied into the worktree");
  assert.equal(classifyProject(wtPath).kind, "untyped-existing", "worktree is no longer classified as greenfield");

  teardownAutoWorktree(base, "M001");
});

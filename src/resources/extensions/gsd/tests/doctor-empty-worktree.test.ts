// Project/App: gsd-pi
// File Purpose: Regression tests for doctor repair of empty milestone worktrees.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runGSDDoctor } from "../doctor.ts";
import { createWorktree, worktreePath } from "../worktree-manager.ts";

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  }).trim();
}

function makeRepo(): string {
  const base = mkdtempSync(join(tmpdir(), "gsd-doctor-empty-worktree-"));
  runGit(["init", "-b", "main"], base);
  runGit(["config", "user.name", "Test User"], base);
  runGit(["config", "user.email", "test@example.com"], base);
  writeFileSync(join(base, "package.json"), "{\"scripts\":{}}\n", "utf-8");
  runGit(["add", "."], base);
  runGit(["commit", "-m", "chore: init"], base);
  return base;
}

function makeRepoWithOnlyGitignoreCommitted(): string {
  const base = mkdtempSync(join(tmpdir(), "gsd-doctor-empty-worktree-"));
  runGit(["init", "-b", "main"], base);
  runGit(["config", "user.name", "Test User"], base);
  runGit(["config", "user.email", "test@example.com"], base);
  writeFileSync(join(base, ".gitignore"), "node_modules\n", "utf-8");
  runGit(["add", "."], base);
  runGit(["commit", "-m", "chore: init gitignore"], base);
  return base;
}

test("doctor fix recreates an empty registered milestone worktree", async (t) => {
  const base = makeRepo();
  t.after(() => rmSync(base, { recursive: true, force: true }));

  createWorktree(base, "M001", { branch: "milestone/M001" });
  const wtPath = worktreePath(base, "M001");
  writeFileSync(join(wtPath, "milestone-note.txt"), "worktree branch content\n", "utf-8");
  runGit(["add", "milestone-note.txt"], wtPath);
  runGit(["commit", "-m", "test: add milestone content"], wtPath);
  for (const entry of readdirSync(wtPath)) {
    if (entry === ".git") continue;
    rmSync(join(wtPath, entry), { recursive: true, force: true });
  }
  assert.ok(existsSync(join(wtPath, ".git")), "test setup keeps registered worktree marker");
  assert.equal(existsSync(join(wtPath, "package.json")), false, "test setup removes project content");

  const report = await runGSDDoctor(base, {
    fix: true,
    fixLevel: "all",
    isolationMode: "worktree",
  });

  assert.ok(
    report.issues.some((issue) => issue.code === "worktree_empty_with_project_content"),
    "doctor reports the empty worktree",
  );
  assert.ok(
    report.fixesApplied.some((fix) => fix.includes("recreated empty worktree")),
    "doctor applies the repair",
  );
  assert.ok(existsSync(join(wtPath, "package.json")), "worktree content is restored");
  assert.ok(existsSync(join(wtPath, "milestone-note.txt")), "branch content is restored");
});

test("doctor fix recreates an empty worktree when cwd is inside that worktree", async (t) => {
  const base = makeRepo();
  const originalCwd = process.cwd();
  t.after(() => {
    try {
      process.chdir(originalCwd);
    } catch { /* ignore deleted cwd during cleanup */ }
    rmSync(base, { recursive: true, force: true });
  });

  createWorktree(base, "M001", { branch: "milestone/M001" });
  const wtPath = worktreePath(base, "M001");
  for (const entry of readdirSync(wtPath)) {
    if (entry === ".git") continue;
    rmSync(join(wtPath, entry), { recursive: true, force: true });
  }
  process.chdir(wtPath);

  const report = await runGSDDoctor(base, {
    fix: true,
    fixLevel: "all",
    isolationMode: "worktree",
  });

  assert.ok(
    report.fixesApplied.some((fix) => fix.includes("recreated empty worktree")),
    "doctor applies the repair while cwd is in the worktree",
  );
  assert.ok(existsSync(join(wtPath, "package.json")), "worktree content is restored");
});

test("doctor fix imports untracked project-root content when the worktree only has git metadata", async (t) => {
  const base = makeRepoWithOnlyGitignoreCommitted();
  t.after(() => rmSync(base, { recursive: true, force: true }));

  mkdirSync(join(base, ".gsd"), { recursive: true });
  writeFileSync(join(base, ".gsd", "PREFERENCES.md"), "---\ngit:\n  isolation: worktree\n---\n", "utf-8");
  writeFileSync(join(base, "package.json"), "{\"scripts\":{}}\n", "utf-8");
  createWorktree(base, "M001", { branch: "milestone/M001" });
  const wtPath = worktreePath(base, "M001");
  assert.ok(existsSync(join(wtPath, ".gitignore")), "test setup keeps committed non-content metadata");
  assert.equal(existsSync(join(wtPath, "package.json")), false, "test setup leaves project content only at the root");

  const report = await runGSDDoctor(base, {
    fix: true,
    fixLevel: "all",
  });

  assert.ok(
    report.issues.some((issue) => issue.code === "worktree_empty_with_project_content"),
    "doctor reports the empty worktree even when .gitignore exists",
  );
  assert.ok(
    report.fixesApplied.some((fix) => fix.includes("copied") && fix.includes("project file")),
    "doctor copies the root project content into the recreated worktree",
  );
  assert.ok(existsSync(join(wtPath, "package.json")), "untracked project content is restored into the worktree");
});

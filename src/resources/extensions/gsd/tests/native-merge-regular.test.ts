// Regression tests for nativeMergeRegular (#549 — merge_strategy: merge).
//
// nativeMergeRegular is the new `git merge --no-ff --no-commit` path called
// when `git.merge_strategy: merge` is configured. These tests verify:
//   1. Success path: returns { success: true, conflicts: [] } and leaves MERGE_HEAD
//      so nativeCommit can supply the commit message and git records two parents.
//   2. Dirty-tree path: returns __dirty_working_tree__ sentinel (matching
//      nativeMergeSquash behaviour) when uncommitted changes would be overwritten.
//   3. Content-conflict path: returns the conflicted file names (not the dirty-tree
//      sentinel) when both branches modified the same region of a file.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { nativeMergeRegular } from "../native-git-bridge.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  }).trim();
}

function makeRepo(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  git(dir, "init");
  git(dir, "config", "user.email", "test@test.com");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "README.md"), "# init\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-m", "init");
  git(dir, "branch", "-M", "main");
  return dir;
}

describe("nativeMergeRegular (#549)", () => {
  const tempDirs: string[] = [];

  function freshRepo(prefix: string = "nmr-"): string {
    const d = makeRepo(prefix);
    tempDirs.push(d);
    return d;
  }

  afterEach(() => {
    for (const d of tempDirs) {
      try {
        git(d, "merge", "--abort");
      } catch {
        // no merge in progress — that is fine
      }
      if (existsSync(d)) rmSync(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  test("success: returns { success: true, conflicts: [] } and sets MERGE_HEAD", () => {
    const repo = freshRepo("nmr-success-");
    git(repo, "checkout", "-b", "feature");
    writeFileSync(join(repo, "feature.ts"), "export const a = 1;\n");
    git(repo, "add", "feature.ts");
    git(repo, "commit", "-m", "add feature");
    git(repo, "checkout", "main");

    const result = nativeMergeRegular(repo, "feature");

    assert.equal(result.success, true);
    assert.deepEqual(result.conflicts, []);
    // --no-commit leaves MERGE_HEAD; nativeCommit sees it and creates two parents.
    assert.ok(
      existsSync(join(repo, ".git", "MERGE_HEAD")),
      "MERGE_HEAD must exist after --no-ff --no-commit so the caller commits a true merge",
    );
  });

  test("dirty working tree: returns __dirty_working_tree__ sentinel", () => {
    const repo = freshRepo("nmr-dirty-");

    // feature branch introduces feature.ts
    git(repo, "checkout", "-b", "feature");
    writeFileSync(join(repo, "feature.ts"), "export const x = 1;\n");
    git(repo, "add", "feature.ts");
    git(repo, "commit", "-m", "add feature");
    git(repo, "checkout", "main");

    // dirty uncommitted local file that the merge would overwrite
    writeFileSync(join(repo, "feature.ts"), "// local dirty version\n");

    const result = nativeMergeRegular(repo, "feature");

    assert.equal(result.success, false);
    assert.ok(
      result.conflicts.includes("__dirty_working_tree__"),
      `expected __dirty_working_tree__ sentinel, got: ${JSON.stringify(result.conflicts)}`,
    );
  });

  test("content conflict: returns conflicted file names, not dirty-tree sentinel", () => {
    const repo = freshRepo("nmr-conflict-");

    // Diverging history: both main and feature modify the same file region.
    writeFileSync(join(repo, "shared.ts"), "// base\nexport const v = 0;\n");
    git(repo, "add", "shared.ts");
    git(repo, "commit", "-m", "base version");

    git(repo, "checkout", "-b", "feature");
    writeFileSync(join(repo, "shared.ts"), "// feature version\nexport const v = 2;\n");
    git(repo, "add", "shared.ts");
    git(repo, "commit", "-m", "feature changes shared");

    git(repo, "checkout", "main");
    writeFileSync(join(repo, "shared.ts"), "// main version\nexport const v = 1;\n");
    git(repo, "add", "shared.ts");
    git(repo, "commit", "-m", "main changes shared");

    const result = nativeMergeRegular(repo, "feature");

    assert.equal(result.success, false);
    assert.ok(
      result.conflicts.includes("shared.ts"),
      `expected shared.ts in conflicts, got: ${JSON.stringify(result.conflicts)}`,
    );
    assert.ok(
      !result.conflicts.includes("__dirty_working_tree__"),
      "content conflict must not be misclassified as dirty-tree",
    );
  });
});

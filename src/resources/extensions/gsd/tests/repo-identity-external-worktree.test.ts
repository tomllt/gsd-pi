import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

import { ensureGsdSymlink } from "../repo-identity.ts";
import {
  resolveExternalStateProjectGsdFromWorktreePath,
  resolveExternalStateProjectIdentityFromWorktreePath,
} from "../worktree-root.ts";

function run(command: string, cwd: string): string {
  return execSync(command, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" }).trim();
}

describe("repo-identity-external-worktree", () => {
  let stateDir: string;
  let projectHash: string;
  let parentState: string;
  let worktreePath: string;

  before(() => {
    stateDir = realpathSync(mkdtempSync(join(tmpdir(), "gsd-external-wt-state-")));
    process.env.GSD_STATE_DIR = stateDir;

    projectHash = "parentproject1";
    parentState = join(stateDir, "projects", projectHash);
    mkdirSync(parentState, { recursive: true });
    writeFileSync(join(parentState, "gsd.db"), "parent-db-marker\n", "utf-8");
    writeFileSync(
      join(parentState, "repo-meta.json"),
      JSON.stringify({
        version: 1,
        hash: projectHash,
        gitRoot: "/tmp/example-project",
        remoteUrl: "",
        createdAt: new Date().toISOString(),
      }, null, 2) + "\n",
      "utf-8",
    );

    worktreePath = join(parentState, "worktrees", "M003-testwt");
    mkdirSync(worktreePath, { recursive: true });

    // External-state worktrees often have a full `.git` directory (not gitdir:).
    run("git init -b main", worktreePath);
    run('git config user.name "Pi Test"', worktreePath);
    run('git config user.email "pi@example.com"', worktreePath);
    writeFileSync(join(worktreePath, "README.md"), "# External Worktree\n", "utf-8");
    run("git add README.md", worktreePath);
    run('git commit -m "chore: init worktree repo"', worktreePath);
  });

  after(() => {
    delete process.env.GSD_STATE_DIR;
    rmSync(stateDir, { recursive: true, force: true });
  });

  test("resolveExternalStateProjectGsdFromWorktreePath returns parent store", () => {
    assert.equal(
      resolveExternalStateProjectGsdFromWorktreePath(worktreePath),
      parentState,
    );
    assert.equal(
      resolveExternalStateProjectIdentityFromWorktreePath(worktreePath),
      projectHash,
    );
  });

  test("ensureGsdSymlink points external worktree at parent external state dir", () => {
    const resolved = ensureGsdSymlink(worktreePath);
    assert.equal(resolved, parentState);
    assert.ok(existsSync(join(worktreePath, ".gsd")));
    assert.ok(lstatSync(join(worktreePath, ".gsd")).isSymbolicLink());
    assert.equal(realpathSync(join(worktreePath, ".gsd")), realpathSync(parentState));
  });

  test("ensureGsdSymlink heals stale external-worktree symlinks", () => {
    const staleState = join(stateDir, "projects", "stale-external-wt");
    mkdirSync(staleState, { recursive: true });
    rmSync(join(worktreePath, ".gsd"), { recursive: true, force: true });
    symlinkSync(staleState, join(worktreePath, ".gsd"), "junction");

    const healed = ensureGsdSymlink(worktreePath);
    assert.equal(healed, parentState);
    assert.equal(realpathSync(join(worktreePath, ".gsd")), realpathSync(parentState));
  });
});

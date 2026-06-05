// gsd-pi + Repository registry seam tests.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRepositoryRegistryFromPreferences, defaultRepositoryTargets } from "../repository-registry.ts";

test("repository registry includes implicit project root and declared child repos", (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-repo-registry-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, ".gsd"), { recursive: true });
  mkdirSync(join(base, "frontend"), { recursive: true });
  mkdirSync(join(base, "backend"), { recursive: true });

  const registry = createRepositoryRegistryFromPreferences(base, {
    workspace: {
      mode: "parent",
      repositories: {
        frontend: { path: "frontend", role: "web UI", verification: ["npm test"] },
        backend: { path: "./backend", role: "API", commit_policy: "skip" },
      },
    },
  });

  assert.equal(registry.mode, "parent");
  assert.equal(registry.projectRoot, base);
  assert.equal(registry.byId.size, 3);
  assert.equal(registry.byId.get("project")?.root, base);
  assert.equal(registry.byId.get("frontend")?.root, join(base, "frontend"));
  assert.equal(registry.byId.get("backend")?.root, join(base, "backend"));
  assert.deepEqual(registry.byId.get("frontend")?.verification, ["npm test"]);
  assert.equal(registry.byId.get("frontend")?.role, "web UI");
  assert.equal(registry.byId.get("backend")?.commitPolicy, "skip");
  assert.equal(registry.byId.get("backend")?.role, "API");
});

test("repository registry rejects repositories outside project root", (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-repo-registry-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, ".gsd"), { recursive: true });

  assert.throws(
    () => createRepositoryRegistryFromPreferences(base, {
      workspace: {
        mode: "parent",
        repositories: {
          unsafe: { path: "../outside" },
        },
      },
    }),
    /outside project root/,
  );
});

test('repository registry rejects explicit "project" repository id', (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-repo-registry-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, ".gsd"), { recursive: true });

  assert.throws(
    () => createRepositoryRegistryFromPreferences(base, {
      workspace: {
        mode: "parent",
        repositories: {
          project: { path: "." },
        },
      },
    }),
    /reserved/,
  );
});

test("defaultRepositoryTargets returns [project] for a single-repo project registry", (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-repo-registry-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, ".gsd"), { recursive: true });

  const registry = createRepositoryRegistryFromPreferences(base, undefined);

  assert.deepEqual(defaultRepositoryTargets(registry), ["project"]);
});

test("defaultRepositoryTargets returns [project] for a parent-mode registry", (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-repo-registry-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, ".gsd"), { recursive: true });
  mkdirSync(join(base, "frontend"), { recursive: true });

  const registry = createRepositoryRegistryFromPreferences(base, {
    workspace: {
      mode: "parent",
      repositories: {
        frontend: { path: "frontend" },
      },
    },
  });

  assert.deepEqual(defaultRepositoryTargets(registry), ["project"]);
});

test("repository registry keeps project root anchored to .gsd project in monorepo subdirectory", (t) => {
  const monorepo = mkdtempSync(join(tmpdir(), "gsd-repo-registry-mono-"));
  t.after(() => rmSync(monorepo, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: monorepo, stdio: "ignore" });

  const subproject = join(monorepo, "fieldkit-tools");
  mkdirSync(join(subproject, ".gsd"), { recursive: true });
  writeFileSync(join(subproject, ".gsd", "PREFERENCES.md"), "---\nversion: 1\n---\n");

  const registry = createRepositoryRegistryFromPreferences(subproject, undefined);

  assert.equal(registry.projectRoot, subproject);
  assert.equal(registry.byId.get("project")?.root, subproject);
});

test("repository registry uses external-state worktree checkout as project root", (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "gsd-repo-registry-external-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const worktree = join(base, ".gsd", "projects", "abc123", "worktrees", "M001");
  mkdirSync(worktree, { recursive: true });
  execFileSync("git", ["init"], { cwd: worktree, stdio: "ignore" });

  const registry = createRepositoryRegistryFromPreferences(worktree, undefined);

  assert.equal(registry.projectRoot, worktree);
  assert.equal(registry.byId.get("project")?.root, worktree);
});

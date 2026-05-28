// Project/App: gsd-pi
// File Purpose: Regression tests for installer package dependencies.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

/** External deps that must ship inside the tarball for --ignore-scripts global installs. */
const REQUIRED_BUNDLED_EXTERNALS = [
  "@modelcontextprotocol/sdk",
  "minimatch",
  "picomatch",
  "proper-lockfile",
  "undici",
  "yaml",
];

test("installer deps module exposes postinstall orchestration", async () => {
  const { runPostinstallDeps, linkWorkspacePackages } = await import("../install/deps.js");
  assert.equal(typeof runPostinstallDeps, "function");
  assert.equal(typeof linkWorkspacePackages, "function");
});

test("installer tarball bundles extension-critical externals at the package root", () => {
  for (const dep of REQUIRED_BUNDLED_EXTERNALS) {
    assert.ok(pkg.dependencies[dep], `root package must depend on ${dep}`);
    assert.ok(
      pkg.bundledDependencies.includes(dep),
      `root bundledDependencies must include ${dep}`,
    );
  }
});

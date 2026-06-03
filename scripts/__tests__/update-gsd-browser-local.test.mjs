// Project/App: gsd-pi
// File Purpose: Fast-gate coverage for the local gsd-browser update helper.

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  expandHome,
  parseArgs,
  resolveCargoBinaryPath,
  resolveInstalledGsdBrowserBinaryPath,
  updateInstalledGsdBrowser,
} from "../update-gsd-browser-local.mjs";

function makeFakeSource(root, profile = "debug") {
  const sourceRoot = join(root, "gsd-browser");
  mkdirSync(join(sourceRoot, "npm"), { recursive: true });
  mkdirSync(join(sourceRoot, "target", profile), { recursive: true });
  writeFileSync(join(sourceRoot, "Cargo.toml"), "[workspace]\n");
  writeFileSync(
    join(sourceRoot, "npm", "package.json"),
    `${JSON.stringify({ name: "@opengsd/gsd-browser", version: "9.9.9" }, null, 2)}\n`,
  );

  const binaryPath = resolveCargoBinaryPath(sourceRoot, profile, "darwin");
  writeFileSync(binaryPath, "#!/usr/bin/env sh\necho gsd-browser 9.9.9\n");
  chmodSync(binaryPath, 0o755);
  return { sourceRoot, binaryPath };
}

test("expandHome resolves only leading home markers", () => {
  assert.equal(expandHome("~/github/open-gsd", "/Users/dev"), "/Users/dev/github/open-gsd");
  assert.equal(expandHome("~", "/Users/dev"), "/Users/dev");
  assert.equal(expandHome("/tmp/~literal", "/Users/dev"), "/tmp/~literal");
});

test("parseArgs accepts explicit source and build flags", () => {
  const source = resolve("/tmp/gsd-browser");
  const options = parseArgs(["--source", source, "--debug", "--skip-build", "--no-verify"], {});

  assert.equal(options.sourceRoot, source);
  assert.equal(options.profile, "debug");
  assert.equal(options.skipBuild, true);
  assert.equal(options.verify, false);
});

test("parseArgs accepts positional source", () => {
  const source = resolve("/tmp/positional-gsd-browser");
  const options = parseArgs([source, "--release"], {});

  assert.equal(options.sourceRoot, source);
  assert.equal(options.profile, "release");
});

test("parseArgs ignores pnpm's forwarded argument separator", () => {
  const options = parseArgs(["--", "--help"], {});

  assert.equal(options.help, true);
});

test("updateInstalledGsdBrowser copies an existing local build into the installed package", () => {
  const tmp = mkdtempSync(join(tmpdir(), "gsd-browser-update-"));

  try {
    const { sourceRoot, binaryPath } = makeFakeSource(tmp);
    const packageDir = join(tmp, "installed-package");
    mkdirSync(join(packageDir, "bin"), { recursive: true });
    writeFileSync(join(packageDir, "bin", "gsd-browser"), "#!/usr/bin/env node\n");

    const result = updateInstalledGsdBrowser({
      sourceRoot,
      packageDir,
      sourceBinaryPath: binaryPath,
      profile: "debug",
      platform: "darwin",
      skipBuild: true,
      verify: false,
    });

    const installedBinary = resolveInstalledGsdBrowserBinaryPath(packageDir, "darwin");
    assert.equal(result.targetBinaryPath, installedBinary);
    assert.equal(existsSync(installedBinary), true);
    assert.equal(readFileSync(installedBinary, "utf8"), readFileSync(binaryPath, "utf8"));
    assert.equal(result.npmVersion, "9.9.9");
    assert.ok(result.bytes > 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("updateInstalledGsdBrowser rejects the wrong npm package", () => {
  const tmp = mkdtempSync(join(tmpdir(), "gsd-browser-update-wrong-package-"));

  try {
    const { sourceRoot, binaryPath } = makeFakeSource(tmp);
    writeFileSync(
      join(sourceRoot, "npm", "package.json"),
      `${JSON.stringify({ name: "@opengsd/not-browser", version: "1.0.0" }, null, 2)}\n`,
    );

    assert.throws(
      () => updateInstalledGsdBrowser({
        sourceRoot,
        packageDir: join(tmp, "installed-package"),
        sourceBinaryPath: binaryPath,
        profile: "debug",
        platform: "darwin",
        skipBuild: true,
        verify: false,
      }),
      /Expected .*@opengsd\/gsd-browser/,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

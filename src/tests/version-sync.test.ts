// Project/App: Open GSD
// File Purpose: Tests for release version surface synchronization.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { syncVersionSurfaces, verifyVersionSync } = require(join(process.cwd(), "scripts/lib/version-sync.cjs")) as {
  syncVersionSurfaces: (root: string, version: string, options?: { updateRoot?: boolean }) => void;
  verifyVersionSync: (root: string) => string[];
};

function writeJson(root: string, relativePath: string, value: unknown): void {
  const filePath = join(root, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson<T>(root: string, relativePath: string): T {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8")) as T;
}

function writeText(root: string, relativePath: string, value: string): void {
  const filePath = join(root, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, value);
}

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "open-gsd-version-sync-"));
  writeJson(root, "package.json", { name: "@opengsd/gsd-pi", version: "1.0.0" });
  writeJson(root, "package-lock.json", {
    name: "@opengsd/gsd-pi",
    version: "1.0.0",
    packages: {
      "": { name: "@opengsd/gsd-pi", version: "1.0.0" },
      "extensions/google-search": { name: "@gsd-extensions/google-search", version: "1.0.0" },
      "packages/pi-coding-agent": { name: "@gsd/pi-coding-agent", version: "1.0.0" },
    },
  });
  writeJson(root, "extensions/google-search/package.json", {
    name: "@gsd-extensions/google-search",
    version: "1.0.0",
    peerDependencies: {
      "@gsd/pi-coding-agent": "*",
      "@gsd/pi-tui": "*",
    },
  });
  writeJson(root, "packages/pi-coding-agent/package.json", {
    name: "@gsd/pi-coding-agent",
    version: "1.0.0",
    dependencies: { "@gsd-build/contracts": "^1.0.0" },
  });
  writeJson(root, "packages/contracts/package.json", {
    name: "@gsd-build/contracts",
    version: "1.0.0",
  });
  writeJson(root, "pkg/package.json", { name: "@glittercowboy/gsd", version: "1.0.0" });
  writeJson(root, "native/npm/darwin-arm64/package.json", {
    name: "@opengsd/engine-darwin-arm64",
    version: "1.0.0",
  });
  writeText(
    root,
    "native/Cargo.toml",
    `[workspace]
members = ["crates/*"]

[workspace.package]
version = "1.0.0"
edition = "2021"
`,
  );
  writeText(
    root,
    "native/Cargo.lock",
    `[[package]]
name = "gsd-ast"
version = "1.0.0"

[[package]]
name = "some-dependency"
version = "0.1.0"

[[package]]
name = "gsd-engine"
version = "1.0.0"

[[package]]
name = "gsd-grep"
version = "1.0.0"
`,
  );
  return root;
}

test("verifyVersionSync reports every release-owned surface that drifts from root", () => {
  const root = createFixture();
  writeJson(root, "package.json", { name: "@opengsd/gsd-pi", version: "2.0.0" });

  const issues = verifyVersionSync(root);

  assert.match(issues.join("\n"), /extensions\/google-search\/package\.json version is 1\.0\.0, expected 2\.0\.0/);
  assert.match(issues.join("\n"), /packages\/contracts\/package\.json version is 1\.0\.0, expected 2\.0\.0/);
  assert.match(issues.join("\n"), /packages\/pi-coding-agent\/package\.json version is 1\.0\.0, expected 2\.0\.0/);
  assert.match(
    issues.join("\n"),
    /packages\/pi-coding-agent\/package\.json dependencies\.@gsd-build\/contracts is \^1\.0\.0, expected \^2\.0\.0/,
  );
  assert.match(issues.join("\n"), /native\/Cargo\.toml workspace package version is 1\.0\.0, expected 2\.0\.0/);
  assert.match(issues.join("\n"), /native\/Cargo\.lock gsd-engine version is 1\.0\.0, expected 2\.0\.0/);
});

test("syncVersionSurfaces updates package, native, and bridge versions together", () => {
  const root = createFixture();

  syncVersionSurfaces(root, "2.1.0-dev.abc123");

  assert.equal(readJson<{ version: string }>(root, "package.json").version, "2.1.0-dev.abc123");
  assert.equal(readJson<{ version: string }>(root, "extensions/google-search/package.json").version, "2.1.0-dev.abc123");
  assert.equal(readJson<{ version: string }>(root, "packages/contracts/package.json").version, "2.1.0-dev.abc123");
  assert.equal(readJson<{ version: string }>(root, "pkg/package.json").version, "2.1.0-dev.abc123");
  assert.equal(
    readJson<{ dependencies: Record<string, string> }>(root, "packages/pi-coding-agent/package.json").dependencies[
      "@gsd-build/contracts"
    ],
    "^2.1.0-dev.abc123",
  );
  assert.deepEqual(readJson<{ peerDependencies: Record<string, string> }>(root, "extensions/google-search/package.json").peerDependencies, {
    "@gsd/pi-coding-agent": "*",
    "@gsd/pi-tui": "*",
  });
  assert.match(readFileSync(join(root, "native/Cargo.toml"), "utf8"), /version = "2\.1\.0-dev\.abc123"/);
  assert.match(readFileSync(join(root, "native/Cargo.lock"), "utf8"), /name = "gsd-engine"\nversion = "2\.1\.0-dev\.abc123"/);
});

test("syncVersionSurfaces is safe to rerun at the same native version", () => {
  const root = createFixture();

  syncVersionSurfaces(root, "1.0.0");
  syncVersionSurfaces(root, "1.0.0");

  assert.match(readFileSync(join(root, "native/Cargo.toml"), "utf8"), /version = "1\.0\.0"/);
  assert.match(readFileSync(join(root, "native/Cargo.lock"), "utf8"), /name = "gsd-engine"\nversion = "1\.0\.0"/);
});

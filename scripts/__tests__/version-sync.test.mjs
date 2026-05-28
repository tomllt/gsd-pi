// Project/App: gsd-pi
// File Purpose: Regression coverage for release version surface sync.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { RELEASE_WORKSPACE_PACKAGE_DIRS, resolveEngineOptionalDependencyVersion, syncVersionSurfaces } = require("../lib/version-sync.cjs");

test("resolveEngineOptionalDependencyVersion keeps dev publishes on stable engine packages", () => {
  assert.equal(resolveEngineOptionalDependencyVersion("1.0.2-dev.adee50b"), "1.0.2");
  assert.equal(resolveEngineOptionalDependencyVersion("1.0.2"), "1.0.2");
  assert.equal(resolveEngineOptionalDependencyVersion("1.0.2-next.3"), "1.0.2-next.3");
});

test("version sync includes cloud-mcp-gateway so dev stamps keep workspace links", () => {
  assert.ok(
    RELEASE_WORKSPACE_PACKAGE_DIRS.includes("packages/cloud-mcp-gateway"),
    "cloud-mcp-gateway must be synced during dev version stamping",
  );
});

test("syncVersionSurfaces rewrites internal deps to the stamped prerelease version", () => {
  const root = mkdtempSync(join(tmpdir(), "gsd-version-sync-"));
  const devVersion = "1.0.2-dev.abc1234";

  try {
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({ name: "@opengsd/gsd-pi", version: "1.0.2" }, null, 2)}\n`,
    );

    mkdirSync(join(root, "packages", "mcp-server"), { recursive: true });
    writeFileSync(
      join(root, "packages", "mcp-server", "package.json"),
      `${JSON.stringify({
        name: "@opengsd/mcp-server",
        version: "1.0.2",
      }, null, 2)}\n`,
    );

    mkdirSync(join(root, "packages", "cloud-mcp-gateway"), { recursive: true });
    writeFileSync(
      join(root, "packages", "cloud-mcp-gateway", "package.json"),
      `${JSON.stringify({
        name: "@opengsd/cloud-mcp-gateway",
        version: "1.0.2",
        dependencies: {
          "@opengsd/mcp-server": "^1.0.2",
        },
      }, null, 2)}\n`,
    );

    syncVersionSurfaces(root, devVersion);

    const mcpServer = JSON.parse(readFileSync(join(root, "packages", "mcp-server", "package.json"), "utf8"));
    const gateway = JSON.parse(readFileSync(join(root, "packages", "cloud-mcp-gateway", "package.json"), "utf8"));

    assert.equal(mcpServer.version, devVersion);
    assert.equal(gateway.version, devVersion);
    assert.equal(gateway.dependencies["@opengsd/mcp-server"], "workspace:*");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

#!/usr/bin/env node
// Project/App: Open GSD
// File Purpose: Release version bump entry point.
/**
 * Bump version in package.json, then sync platform packages and pkg/package.json.
 * Usage: node scripts/bump-version.mjs <new-version>
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import versionSync from "./lib/version-sync.cjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const { syncVersionSurfaces } = versionSync;

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error("Usage: node scripts/bump-version.mjs <X.Y.Z>");
  process.exit(1);
}

// 1. Update root package.json
const pkgPath = resolve(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const oldVersion = pkg.version;
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`[bump-version] package.json: ${oldVersion} → ${newVersion}`);

// 2. Update release-owned package, native, and bridge version surfaces.
syncVersionSurfaces(root, newVersion, { updateRoot: false });
console.log(`[bump-version] release version surfaces synced to ${newVersion}`);

// 2b. Pin root optionalDependencies to the same engine version as the release.
execSync("node native/scripts/sync-platform-versions.cjs", { cwd: root, stdio: "inherit" });
console.log(`[bump-version] optionalDependencies pinned to ${newVersion}`);

// 3. Regenerate pnpm-lock.yaml to match the new version.
execSync("pnpm install --lockfile-only", { cwd: root, stdio: "inherit" });
console.log(`[bump-version] pnpm-lock.yaml regenerated at ${newVersion}`);

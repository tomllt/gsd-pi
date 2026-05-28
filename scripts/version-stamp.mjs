// Project/App: Open GSD
// File Purpose: Development prerelease version stamping.
import { readFileSync, writeFileSync } from "fs";
import { execFileSync, execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import versionSync from "./lib/version-sync.cjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const { syncVersionSurfaces } = versionSync;

const pkgPath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const shortSha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const channel = process.env.VERSION_CHANNEL || "dev";
const devVersion = `${pkg.version}-${channel}.${shortSha}`;

pkg.version = devVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`Stamped version: ${devVersion}`);

syncVersionSurfaces(root, devVersion, { updateRoot: false });
console.log(`[version-stamp] release version surfaces synced to ${devVersion}`);

// Regenerate pnpm-lock.yaml to reflect the stamped dev version.
execSync("pnpm install --lockfile-only", { cwd: root, stdio: "inherit" });
console.log(`[version-stamp] pnpm-lock.yaml regenerated at ${devVersion}`);

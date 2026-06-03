#!/usr/bin/env node
// Project/App: gsd-pi
// File Purpose: Refresh the installed @opengsd/gsd-browser binary from a local checkout.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, chmodSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_GSD_BROWSER_SOURCE = "~/github/open-gsd/gsd-browser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const PACKAGE_NAME = "@opengsd/gsd-browser";

function usage() {
  return [
    "Usage: pnpm run update:gsd-browser -- [options] [source]",
    "",
    "Build gsd-browser from a local checkout and copy the native binary into",
    "this repo's installed @opengsd/gsd-browser package.",
    "",
    "Options:",
    `  --source <path>   Source checkout (default: ${DEFAULT_GSD_BROWSER_SOURCE})`,
    "  --debug           Use target/debug instead of target/release",
    "  --release         Use target/release (default)",
    "  --skip-build      Reuse the existing Cargo build output",
    "  --no-verify       Skip running the copied binary with --version",
    "  -h, --help        Show this help",
  ].join("\n");
}

export function expandHome(input, home = homedir()) {
  if (input === "~") return home;
  if (input.startsWith("~/")) return join(home, input.slice(2));
  return input;
}

function isTruthy(value) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    sourceRoot: expandHome(env.GSD_BROWSER_SOURCE || DEFAULT_GSD_BROWSER_SOURCE),
    profile: env.GSD_BROWSER_BUILD_PROFILE === "debug" ? "debug" : "release",
    root: REPO_ROOT,
    skipBuild: isTruthy(env.GSD_BROWSER_SKIP_BUILD || ""),
    verify: env.GSD_BROWSER_VERIFY !== "0",
    help: false,
  };

  let positionalSourceSeen = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--source" || arg === "--repo") {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a path`);
      options.sourceRoot = expandHome(value);
      continue;
    }
    if (arg.startsWith("--source=")) {
      options.sourceRoot = expandHome(arg.slice("--source=".length));
      continue;
    }
    if (arg === "--debug") {
      options.profile = "debug";
      continue;
    }
    if (arg === "--release") {
      options.profile = "release";
      continue;
    }
    if (arg === "--skip-build") {
      options.skipBuild = true;
      continue;
    }
    if (arg === "--no-verify") {
      options.verify = false;
      continue;
    }
    if (!arg.startsWith("-") && !positionalSourceSeen) {
      positionalSourceSeen = true;
      options.sourceRoot = expandHome(arg);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return {
    ...options,
    sourceRoot: resolve(options.sourceRoot),
  };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function resolveCargoBinaryPath(sourceRoot, profile = "release", platform = process.platform) {
  const binaryName = platform === "win32" ? "gsd-browser.exe" : "gsd-browser";
  return join(sourceRoot, "target", profile, binaryName);
}

export function resolveInstalledGsdBrowserPackageDir(root = REPO_ROOT) {
  const requireFromRoot = createRequire(join(root, "package.json"));
  return dirname(requireFromRoot.resolve(`${PACKAGE_NAME}/package.json`));
}

export function resolveInstalledGsdBrowserBinaryPath(packageDir, platform = process.platform) {
  const binaryName = platform === "win32" ? "gsd-browser.exe" : "gsd-browser-bin";
  return join(packageDir, "bin", binaryName);
}

function assertSourceCheckout(sourceRoot) {
  const cargoManifestPath = join(sourceRoot, "Cargo.toml");
  const npmPackageJsonPath = join(sourceRoot, "npm", "package.json");
  if (!existsSync(cargoManifestPath)) {
    throw new Error(`Missing Cargo manifest: ${cargoManifestPath}`);
  }
  if (!existsSync(npmPackageJsonPath)) {
    throw new Error(`Missing npm package manifest: ${npmPackageJsonPath}`);
  }

  const npmPackage = readJson(npmPackageJsonPath);
  if (npmPackage.name !== PACKAGE_NAME) {
    throw new Error(`Expected ${npmPackageJsonPath} to be ${PACKAGE_NAME}`);
  }

  return {
    cargoManifestPath,
    npmVersion: npmPackage.version || "0.0.0",
  };
}

function runCargoBuild(sourceRoot, cargoManifestPath, profile) {
  const args = ["build", "--manifest-path", cargoManifestPath, "--package", "gsd-browser"];
  if (profile === "release") args.push("--release");
  execFileSync("cargo", args, {
    cwd: sourceRoot,
    stdio: "inherit",
  });
}

function copyBrowserBinary(sourceBinaryPath, targetBinaryPath, platform) {
  if (!existsSync(sourceBinaryPath)) {
    throw new Error(`Built gsd-browser binary not found: ${sourceBinaryPath}`);
  }

  mkdirSync(dirname(targetBinaryPath), { recursive: true });
  copyFileSync(sourceBinaryPath, targetBinaryPath);
  if (platform !== "win32") chmodSync(targetBinaryPath, 0o755);

  const launcherPath = join(dirname(targetBinaryPath), "gsd-browser");
  if (platform !== "win32" && existsSync(launcherPath)) chmodSync(launcherPath, 0o755);

  return statSync(targetBinaryPath).size;
}

function verifyBrowserBinary(targetBinaryPath) {
  return execFileSync(targetBinaryPath, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function updateInstalledGsdBrowser(options = {}) {
  const sourceRoot = resolve(expandHome(options.sourceRoot || DEFAULT_GSD_BROWSER_SOURCE));
  const profile = options.profile || "release";
  const platform = options.platform || process.platform;
  const { cargoManifestPath, npmVersion } = assertSourceCheckout(sourceRoot);

  if (!options.skipBuild) {
    runCargoBuild(sourceRoot, cargoManifestPath, profile);
  }

  const packageDir = options.packageDir || resolveInstalledGsdBrowserPackageDir(options.root || REPO_ROOT);
  const sourceBinaryPath = options.sourceBinaryPath || resolveCargoBinaryPath(sourceRoot, profile, platform);
  const targetBinaryPath = resolveInstalledGsdBrowserBinaryPath(packageDir, platform);
  const bytes = copyBrowserBinary(sourceBinaryPath, targetBinaryPath, platform);
  const versionOutput = options.verify === false ? "" : verifyBrowserBinary(targetBinaryPath);

  return {
    sourceRoot,
    profile,
    packageDir,
    sourceBinaryPath,
    targetBinaryPath,
    npmVersion,
    versionOutput,
    bytes,
  };
}

function main() {
  const options = parseArgs();
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  process.stdout.write(`Updating ${PACKAGE_NAME} from ${options.sourceRoot}\n`);
  process.stdout.write(`Profile: ${options.profile}${options.skipBuild ? " (skip build)" : ""}\n`);

  const result = updateInstalledGsdBrowser(options);
  process.stdout.write(`Copied ${result.bytes} bytes to ${result.targetBinaryPath}\n`);
  if (result.versionOutput) {
    process.stdout.write(`Verified: ${result.versionOutput}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

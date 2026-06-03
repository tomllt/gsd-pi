import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GSD_BROWSER_MCP_SERVER_NAME = "gsd-browser";

export interface GsdBrowserMcpLaunchConfig {
  serverName: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  projectRoot: string;
  sessionName: string;
}

export interface GsdBrowserMcpLaunchOptions {
  sessionName?: string;
  sessionSuffix?: string;
}

function parseJsonEnv<T>(env: NodeJS.ProcessEnv, name: string): T | undefined {
  const raw = env[name];
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Invalid JSON in ${name}`);
  }
}

function sanitizeSessionSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function compareSemverLocal(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const leftValue = left[index] || 0;
    const rightValue = right[index] || 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }
  return 0;
}

function parseGsdBrowserVersion(output: string): string | null {
  return output.match(/\b(\d+\.\d+\.\d+)\b/)?.[1] ?? null;
}

function resolveBundledGsdBrowserPackageVersion(): string | null {
  try {
    const requireFromHere = createRequire(import.meta.url);
    const packageJsonPath = requireFromHere.resolve("@opengsd/gsd-browser/package.json");
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version?: unknown };
    return typeof pkg.version === "string" ? parseGsdBrowserVersion(pkg.version) : null;
  } catch {
    return null;
  }
}

function resolvePathGsdBrowserVersion(env: NodeJS.ProcessEnv): string | null {
  const explicit = env.GSD_BROWSER_PATH_VERSION?.trim();
  if (explicit) return parseGsdBrowserVersion(explicit);

  try {
    return parseGsdBrowserVersion(execFileSync("gsd-browser", ["--version"], {
      encoding: "utf-8",
      env,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }));
  } catch {
    return null;
  }
}

function shouldPreferPathGsdBrowser(env: NodeJS.ProcessEnv): boolean {
  const pathVersion = resolvePathGsdBrowserVersion(env);
  if (!pathVersion) return false;

  const bundledVersion = resolveBundledGsdBrowserPackageVersion();
  return !bundledVersion || compareSemverLocal(pathVersion, bundledVersion) > 0;
}

export function resolveBundledGsdBrowserCliPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.GSD_BROWSER_CLI_PATH?.trim() || env.GSD_BROWSER_BIN_PATH?.trim();
  if (explicit) return explicit;

  try {
    const requireFromHere = createRequire(import.meta.url);
    const packageJsonPath = requireFromHere.resolve("@opengsd/gsd-browser/package.json");
    const candidate = resolve(packageJsonPath, "..", "bin", "gsd-browser");
    if (existsSync(candidate)) return candidate;
  } catch {
    // Fall through to path candidates for source/dist layouts.
  }

  const candidates = [
    resolve(fileURLToPath(new URL("../../../../node_modules/@opengsd/gsd-browser/bin/gsd-browser", import.meta.url))),
    resolve(fileURLToPath(new URL("../../../../node_modules/.bin/gsd-browser", import.meta.url))),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

export function buildGsdBrowserSessionName(projectRoot: string, suffix?: string): string {
  const resolvedProjectRoot = resolve(projectRoot);
  const base = sanitizeSessionSegment(basename(resolvedProjectRoot)) || "project";
  const hash = createHash("sha1").update(resolvedProjectRoot).digest("hex").slice(0, 8);
  const cleanSuffix = suffix ? sanitizeSessionSegment(suffix) : "";
  return cleanSuffix ? `gsd-${base}-${hash}-${cleanSuffix}` : `gsd-${base}-${hash}`;
}

export function resolveGsdBrowserMcpLaunchConfig(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  options: GsdBrowserMcpLaunchOptions = {},
): GsdBrowserMcpLaunchConfig {
  const resolvedProjectRoot = resolve(projectRoot);
  const serverName = env.GSD_BROWSER_MCP_NAME?.trim() || GSD_BROWSER_MCP_SERVER_NAME;
  const explicitArgs = parseJsonEnv<unknown>(env, "GSD_BROWSER_MCP_ARGS");
  const explicitEnv = parseJsonEnv<Record<string, string>>(env, "GSD_BROWSER_MCP_ENV");
  const explicitCommand = env.GSD_BROWSER_MCP_COMMAND?.trim();
  const explicitCliPath = env.GSD_BROWSER_CLI_PATH?.trim() || env.GSD_BROWSER_BIN_PATH?.trim();
  const preferPathCli = !explicitCommand && !explicitCliPath && shouldPreferPathGsdBrowser(env);
  const bundledCliPath = !explicitCommand && !explicitCliPath && !preferPathCli
    ? resolveBundledGsdBrowserCliPath(env)
    : null;
  const sessionName =
    options.sessionName?.trim() || buildGsdBrowserSessionName(resolvedProjectRoot, options.sessionSuffix);
  const command =
    explicitCommand
    || explicitCliPath
    || (preferPathCli ? "gsd-browser" : undefined)
    || (bundledCliPath ? process.execPath : undefined)
    || "gsd-browser";
  const args = Array.isArray(explicitArgs) && explicitArgs.length > 0
    ? explicitArgs.map(String)
    : [
        ...(bundledCliPath ? [bundledCliPath] : []),
        "mcp",
        "--session",
        sessionName,
        "--identity-scope",
        "project",
        "--identity-project",
        resolvedProjectRoot,
      ];
  const cwd = env.GSD_BROWSER_MCP_CWD?.trim() || resolvedProjectRoot;

  return {
    serverName,
    command,
    args,
    cwd,
    ...(explicitEnv ? { env: explicitEnv } : {}),
    projectRoot: resolvedProjectRoot,
    sessionName,
  };
}

// Project/App: gsd-pi
// File Purpose: Executor for the gsd_exec MCP tool.

import {
  EXEC_DEFAULTS,
  runExecSandbox,
  type ExecSandboxOptions,
  type ExecSandboxRequest,
  type ExecSandboxResult,
} from "../exec-sandbox.js";
import { realpathSync } from "node:fs";
import path from "node:path";
import { isContextModeEnabled, type ContextModeConfig } from "../preferences-types.js";
import { contextModeDisabledResult, type ToolExecutionResult } from "./context-mode-tool-result.js";

export interface ExecToolParams {
  runtime?: unknown;
  script?: unknown;
  command?: unknown;
  cmd?: unknown;
  code?: unknown;
  purpose?: string;
  metadata?: Record<string, unknown>;
  timeout_ms?: number;
}

export interface ExecToolDeps {
  baseDir: string;
  preferences: { context_mode?: ContextModeConfig } | null;
  /** Optional override for testing. */
  run?: (req: ExecSandboxRequest, opts: ExecSandboxOptions) => Promise<ExecSandboxResult>;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  generateId?: () => string;
}

export type UatExecIntent =
  | "uat-artifact-check"
  | "uat-runtime-check"
  | "uat-browser-check"
  | "uat-service-start"
  | "uat-log-inspection";

export interface UatExecToolParams extends ExecToolParams {
  milestoneId?: unknown;
  sliceId?: unknown;
  checkId?: unknown;
  intent?: unknown;
  expected?: unknown;
}

const UAT_EXEC_INTENTS: readonly UatExecIntent[] = [
  "uat-artifact-check",
  "uat-runtime-check",
  "uat-browser-check",
  "uat-service-start",
  "uat-log-inspection",
] as const;

const UAT_EXEC_INTENT_ALIASES: Record<string, UatExecIntent> = {
  artifact: "uat-artifact-check",
  "artifact-driven": "uat-artifact-check",
  runtime: "uat-runtime-check",
  "runtime-executable": "uat-runtime-check",
  "live-runtime": "uat-runtime-check",
  browser: "uat-browser-check",
  "browser-executable": "uat-browser-check",
  service: "uat-service-start",
  "service-start": "uat-service-start",
  log: "uat-log-inspection",
  logs: "uat-log-inspection",
  "log-inspection": "uat-log-inspection",
};

export function buildExecOptions(
  baseDir: string,
  cfg: ContextModeConfig | undefined,
  extras?: Pick<ExecSandboxOptions, "env" | "now" | "generateId">,
): ExecSandboxOptions {
  const allowlist = Array.isArray(cfg?.exec_env_allowlist) ? cfg!.exec_env_allowlist! : EXEC_DEFAULTS.envAllowlist;
  const stdoutCap = clampNumber(
    cfg?.exec_stdout_cap_bytes,
    EXEC_DEFAULTS.stdoutCapBytes,
    4_096,
    16_777_216,
  );
  const defaultTimeout = clampNumber(
    cfg?.exec_timeout_ms,
    EXEC_DEFAULTS.defaultTimeoutMs,
    1_000,
    EXEC_DEFAULTS.clampTimeoutMs,
  );
  const digestChars = clampNumber(cfg?.exec_digest_chars, EXEC_DEFAULTS.digestChars, 0, 4_000);
  return {
    baseDir,
    clamp_timeout_ms: EXEC_DEFAULTS.clampTimeoutMs,
    default_timeout_ms: defaultTimeout,
    stdout_cap_bytes: stdoutCap,
    stderr_cap_bytes: EXEC_DEFAULTS.stderrCapBytes,
    digest_chars: digestChars,
    env_allowlist: allowlist,
    ...extras,
  };
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return Math.floor(value);
}

function isEnabled(prefs: ExecToolDeps["preferences"]): boolean {
  return isContextModeEnabled(prefs);
}

function paramError(message: string): ToolExecutionResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    details: { operation: "gsd_exec", error: "invalid_params", detail: message },
    isError: true,
  };
}

function normalizeRuntime(value: unknown): ExecSandboxRequest["runtime"] | ToolExecutionResult {
  if (value === undefined || value === null || value === "") return "bash";
  if (typeof value !== "string") {
    return paramError(`invalid runtime "${String(value)}" — must be bash | node | python`);
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "" || normalized === "bash" || normalized === "sh" || normalized === "shell") return "bash";
  if (normalized === "node" || normalized === "nodejs" || normalized === "js" || normalized === "javascript") return "node";
  if (normalized === "python" || normalized === "python3" || normalized === "py") return "python";
  return paramError(`invalid runtime "${value}" — must be bash | node | python`);
}

function normalizeScript(params: ExecToolParams): string | ToolExecutionResult {
  const candidates = [params.script, params.command, params.cmd, params.code];
  let sawNonString = false;
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    if (typeof candidate !== "string") {
      sawNonString = true;
      continue;
    }
    if (candidate.trim().length > 0) return candidate;
  }
  if (sawNonString) {
    return paramError("script/command must be a non-empty string");
  }
  return paramError("script is required and must be a non-empty string");
}

function normalizeRequiredString(value: unknown, field: string): string | ToolExecutionResult {
  if (typeof value !== "string" || value.trim().length === 0) {
    return paramError(`${field} is required and must be a non-empty string`);
  }
  return value.trim();
}

function normalizeUatIntent(value: unknown): UatExecIntent | ToolExecutionResult {
  if (typeof value !== "string") {
    return paramError(`intent is required and must be one of: ${UAT_EXEC_INTENTS.join(", ")}`);
  }
  const normalized = value.trim().toLowerCase();
  if ((UAT_EXEC_INTENTS as readonly string[]).includes(normalized)) return normalized as UatExecIntent;
  const alias = UAT_EXEC_INTENT_ALIASES[normalized];
  if (alias) return alias;
  return paramError(`invalid intent "${value}" — must be one of: ${UAT_EXEC_INTENTS.join(", ")}`);
}

function rejectUatScript(script: string): string | null {
  const patterns: Array<{ re: RegExp; reason: string }> = [
    { re: /\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|remove|update|upgrade)\b/i, reason: "package dependency mutation is not allowed during UAT" },
    { re: /\b(?:pip|pip3|python\s+-m\s+pip)\s+install\b/i, reason: "package dependency mutation is not allowed during UAT" },
    { re: /\bgit\s+(?:add|commit|push|reset|checkout|switch|merge|rebase|clean|rm|mv|tag|branch)\b/i, reason: "git mutations are not allowed during UAT" },
    { re: /\brm\s+-[^\n\r;|&]*r[^\n\r;|&]*f\b/i, reason: "destructive filesystem cleanup is not allowed during UAT" },
    { re: /\b(?:env|printenv)\b(?:\s|$)/i, reason: "dumping environment variables is not allowed during UAT" },
    { re: /\bcat\s+\.env(?:\b|\.|$)/i, reason: "reading credential files is not allowed during UAT" },
  ];
  for (const pattern of patterns) {
    if (pattern.re.test(script)) return pattern.reason;
  }
  return null;
}

function isToolExecutionResult(value: unknown): value is ToolExecutionResult {
  return typeof value === "object" && value !== null && Array.isArray((value as { content?: unknown }).content);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeScanPath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.startsWith("/private/var/")
    ? normalized.slice("/private".length)
    : normalized;
}

function parseWorktreeBase(baseDir: string): { originalRoot: string; worktreeRoot: string } | null {
  const normalizedBase = normalizeScanPath(baseDir);
  const marker = "/.gsd/worktrees/";
  const markerIndex = normalizedBase.indexOf(marker);
  if (markerIndex <= 0) return null;
  return {
    originalRoot: normalizedBase.slice(0, markerIndex),
    worktreeRoot: normalizedBase,
  };
}

function pathInside(parent: string, target: string): boolean {
  const parentWithSep = parent.endsWith("/") ? parent : `${parent}/`;
  return target === parent || target.startsWith(parentWithSep);
}

function comparablePathVariants(value: string): string[] {
  const variants = new Set<string>();
  const normalized = normalizeScanPath(path.resolve(value));
  variants.add(normalized);
  try {
    variants.add(normalizeScanPath(realpathSync(normalized)));
  } catch {
    // Nonexistent paths are still compared lexically.
  }
  if (normalized.startsWith("/private/var/")) {
    variants.add(normalized.replace(/^\/private\/var\//, "/var/"));
  } else if (normalized.startsWith("/var/")) {
    variants.add(`/private${normalized}`);
  }
  return [...variants];
}

function pathInsideAny(parents: readonly string[], targets: readonly string[]): boolean {
  return targets.some((target) => parents.some((parent) => pathInside(parent, target)));
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === "'" || first === '"' || first === "`") && last === first) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function extractPathLikeValues(script: string): string[] {
  const values: string[] = [];
  const push = (candidate: string) => {
    const cleaned = stripWrappingQuotes(candidate).trim();
    if (!cleaned) return;
    values.push(cleaned);
  };
  const pushQuotedLiterals = (source: string, depth = 0) => {
    for (const match of source.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)) {
      push(match[2]);
      if (depth < 2 && /["'`]/.test(match[2])) {
        pushQuotedLiterals(match[2], depth + 1);
      }
    }
  };

  for (const match of script.matchAll(/(?:^|[;\n\r]|\&\&|\|\|)\s*cd\s+([^\n\r;|&]+)/g)) {
    push(match[1]);
  }
  for (const match of script.matchAll(/process\.chdir\(\s*([^\n\r;]+?)\s*\)/g)) {
    push(match[1]);
    pushQuotedLiterals(match[1]);
  }
  pushQuotedLiterals(script);
  return values;
}

function resolvesToOriginalRootOutsideWorktree(script: string, baseDir: string): boolean {
  const parsed = parseWorktreeBase(baseDir);
  if (!parsed) return false;

  const normalizedWorktree = normalizeScanPath(path.resolve(parsed.worktreeRoot));
  const normalizedOriginalRoot = normalizeScanPath(path.resolve(parsed.originalRoot));
  const worktreeRoots = comparablePathVariants(normalizedWorktree);
  const originalRoots = comparablePathVariants(normalizedOriginalRoot);
  for (const value of extractPathLikeValues(script)) {
    const resolved = comparablePathVariants(path.resolve(normalizedWorktree, value));
    if (pathInsideAny(originalRoots, resolved) && !pathInsideAny(worktreeRoots, resolved)) {
      return true;
    }
  }
  return false;
}

function scriptReferencesOriginalRootFromWorktree(script: string, baseDir: string): boolean {
  const parsed = parseWorktreeBase(baseDir);
  if (!parsed) return false;
  const normalizedScript = script.replace(/\\/g, "/");
  return comparablePathVariants(parsed.originalRoot).some((originalRoot) => {
    const originalRootPattern = new RegExp(
      `${escapeRegExp(originalRoot)}(?=$|[\\s'"\\\`;)&|<>]|/(?!\\.gsd/worktrees(?:/|$)))`,
    );
    return originalRootPattern.test(normalizedScript);
  });
}

export async function executeGsdExec(
  params: ExecToolParams,
  deps: ExecToolDeps,
): Promise<ToolExecutionResult> {
  if (!isEnabled(deps.preferences)) return contextModeDisabledResult("gsd_exec");

  const runtime = normalizeRuntime(params.runtime);
  if (isToolExecutionResult(runtime)) return runtime;
  const script = normalizeScript(params);
  if (isToolExecutionResult(script)) return script;
  if (Buffer.byteLength(script, "utf8") > 200_000) {
    return paramError("script exceeds the 200 KB length limit");
  }
  if (
    resolvesToOriginalRootOutsideWorktree(script, deps.baseDir)
    || scriptReferencesOriginalRootFromWorktree(script, deps.baseDir)
  ) {
    return paramError(
      "script references the original project root while running inside a milestone worktree; use the active worktree path or relative paths",
    );
  }

  const opts = buildExecOptions(
    deps.baseDir,
    deps.preferences?.context_mode,
    { env: deps.env, now: deps.now, generateId: deps.generateId },
  );
  const run = deps.run ?? runExecSandbox;

  try {
    const result = await run(
      {
        runtime,
        script,
        ...(typeof params.purpose === "string" ? { purpose: params.purpose } : {}),
        ...(params.metadata && typeof params.metadata === "object" ? { metadata: params.metadata } : {}),
        ...(typeof params.timeout_ms === "number" ? { timeout_ms: params.timeout_ms } : {}),
      },
      opts,
    );
    return formatResult(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: gsd_exec failed — ${message}` }],
      details: { operation: "gsd_exec", error: message },
      isError: true,
    };
  }
}

export async function executeUatExec(
  params: UatExecToolParams,
  deps: ExecToolDeps,
): Promise<ToolExecutionResult> {
  const milestoneId = normalizeRequiredString(params.milestoneId, "milestoneId");
  if (isToolExecutionResult(milestoneId)) return milestoneId;
  const sliceId = normalizeRequiredString(params.sliceId, "sliceId");
  if (isToolExecutionResult(sliceId)) return sliceId;
  const checkId = normalizeRequiredString(params.checkId, "checkId");
  if (isToolExecutionResult(checkId)) return checkId;
  const intent = normalizeUatIntent(params.intent);
  if (isToolExecutionResult(intent)) return intent;
  const script = normalizeScript(params);
  if (isToolExecutionResult(script)) return script;
  const rejected = rejectUatScript(script);
  if (rejected) {
    return {
      content: [{ type: "text", text: `Error: gsd_uat_exec blocked command — ${rejected}` }],
      details: { operation: "gsd_uat_exec", error: "uat_exec_policy_block", reason: rejected },
      isError: true,
    };
  }

  const result = await executeGsdExec(
    {
      ...params,
      script,
      purpose: typeof params.purpose === "string" && params.purpose.trim().length > 0
        ? params.purpose
        : `UAT ${milestoneId}/${sliceId}/${checkId} (${intent})`,
      metadata: {
        kind: "uat_exec",
        milestoneId,
        sliceId,
        checkId,
        intent,
        ...(typeof params.expected === "string" && params.expected.trim().length > 0
          ? { expected: params.expected.trim() }
          : {}),
      },
    },
    deps,
  );
  const details = result.details ?? {};
  return {
    ...result,
    details: {
      ...details,
      operation: "gsd_uat_exec",
      milestoneId,
      sliceId,
      checkId,
      intent,
    },
  };
}

function formatResult(result: ExecSandboxResult): ToolExecutionResult {
  const headerLines = [
    `gsd_exec[${result.id}] runtime=${result.runtime} exit=${formatExit(result)} duration=${result.duration_ms}ms`,
    `  stdout: ${result.stdout_bytes}B${result.stdout_truncated ? " (truncated)" : ""} → ${result.stdout_path}`,
    `  stderr: ${result.stderr_bytes}B${result.stderr_truncated ? " (truncated)" : ""} → ${result.stderr_path}`,
  ];
  const summary = `${headerLines.join("\n")}\n--- digest ---\n${result.digest}`.trimEnd();
  return {
    content: [{ type: "text", text: summary }],
    details: {
      operation: "gsd_exec",
      id: result.id,
      runtime: result.runtime,
      exit_code: result.exit_code,
      signal: result.signal,
      timed_out: result.timed_out,
      duration_ms: result.duration_ms,
      stdout_bytes: result.stdout_bytes,
      stderr_bytes: result.stderr_bytes,
      stdout_truncated: result.stdout_truncated,
      stderr_truncated: result.stderr_truncated,
      stdout_path: result.stdout_path,
      stderr_path: result.stderr_path,
      meta_path: result.meta_path,
    },
    isError: result.timed_out || result.signal !== null || result.exit_code !== 0,
  };
}

function formatExit(result: ExecSandboxResult): string {
  if (result.timed_out) return "timeout";
  if (result.signal) return `signal:${result.signal}`;
  if (result.exit_code === null) return "null";
  return String(result.exit_code);
}

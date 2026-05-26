/**
 * Fill live-test API keys from GSD auth storage when not already in the environment.
 * npm scripts do not source ~/.zshrc; keys must be exported in the current shell
 * or stored in ~/.gsd/agent/auth.json (same as the coding agent).
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type AuthCredential =
  | { type?: unknown; key?: unknown }
  | Array<{ type?: unknown; key?: unknown }>;

type AuthStorageData = Record<string, AuthCredential>;

const PROVIDER_ENV: Array<[providerId: string, envVar: string]> = [
  ["anthropic", "ANTHROPIC_API_KEY"],
  ["openai", "OPENAI_API_KEY"],
];

function expandHome(pathValue: string): string {
  if (pathValue === "~") return homedir();
  if (pathValue.startsWith("~/")) return join(homedir(), pathValue.slice(2));
  return pathValue;
}

function resolveAuthPath(): string {
  const agentDir = process.env.GSD_CODING_AGENT_DIR?.trim();
  if (agentDir) return join(expandHome(agentDir), "auth.json");
  return join(homedir(), ".gsd", "agent", "auth.json");
}

function getStoredApiKey(data: AuthStorageData, providerId: string): string | undefined {
  const raw = data[providerId];
  const credentials = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const credential of credentials) {
    if (credential?.type !== "api_key") continue;
    if (typeof credential.key !== "string") continue;
    if (credential.key.trim().length === 0) continue;
    return credential.key;
  }
  return undefined;
}

/** Populate process.env for live tests from auth.json when vars are unset. */
export function loadLiveCredentialsFromAuth(): string[] {
  const authPath = resolveAuthPath();
  if (!existsSync(authPath)) return [];

  let parsed: AuthStorageData;
  try {
    const data = JSON.parse(readFileSync(authPath, "utf-8")) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return [];
    parsed = data as AuthStorageData;
  } catch {
    return [];
  }

  const loaded: string[] = [];
  for (const [providerId, envVar] of PROVIDER_ENV) {
    if (process.env[envVar]?.trim()) continue;
    const key = getStoredApiKey(parsed, providerId);
    if (!key) continue;
    process.env[envVar] = key;
    loaded.push(`${envVar} (from ${authPath})`);
  }

  // Anthropic live test checks ANTHROPIC_API_KEY only; mirror OAuth token if present.
  if (!process.env.ANTHROPIC_API_KEY?.trim() && process.env.ANTHROPIC_OAUTH_TOKEN?.trim()) {
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_OAUTH_TOKEN;
    loaded.push(`ANTHROPIC_API_KEY (from ANTHROPIC_OAUTH_TOKEN)`);
  }

  return loaded;
}

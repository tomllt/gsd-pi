/**
 * web-app-detect — lightweight, synchronous heuristic for deciding whether the
 * project under development is a web app. Used to decide whether to proactively
 * warm up the managed gsd-browser engine at session start so browser UAT tools
 * are ready instead of failing lazily on first use.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Frontend frameworks / bundlers whose presence in dependencies indicates a
// browser-facing web app worth warming the browser engine for.
const WEB_DEPENDENCY_RE =
  /^(react|react-dom|next|nuxt|vue|@vue\/|svelte|@sveltejs\/|solid-js|astro|@remix-run\/|gatsby|preact|@angular\/core|vite|@vitejs\/|@builder\.io\/qwik|@web\/dev-server|@11ty\/eleventy)/;

// package.json scripts that imply a dev server / browser-facing build.
const WEB_SCRIPT_RE = /\b(vite|next|nuxt|astro|remix|webpack(-dev-server)?|parcel|ng serve|serve\b|http-server|live-server|gatsby)\b/;

interface MinimalPackageJson {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
  scripts?: Record<string, unknown>;
}

function readPackageJson(projectRoot: string): MinimalPackageJson | null {
  const packageJsonPath = resolve(projectRoot, "package.json");
  if (!existsSync(packageJsonPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as MinimalPackageJson) : null;
  } catch {
    return null;
  }
}

function dependencyNames(pkg: MinimalPackageJson): string[] {
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ];
}

/**
 * Returns true when the project looks like a browser-facing web app. Conservative
 * and dependency-free: a false negative just means lazy connection (the prior
 * behavior); a false positive only warms an idle engine connection.
 */
export function detectWebApp(projectRoot: string): boolean {
  const pkg = readPackageJson(projectRoot);
  if (pkg) {
    if (dependencyNames(pkg).some((name) => WEB_DEPENDENCY_RE.test(name))) return true;
    const scriptValues = Object.values(pkg.scripts ?? {}).filter(
      (value): value is string => typeof value === "string",
    );
    if (scriptValues.some((script) => WEB_SCRIPT_RE.test(script))) return true;
  }

  // No package.json signal — fall back to a top-level index.html (static sites).
  if (existsSync(resolve(projectRoot, "index.html"))) return true;
  if (existsSync(resolve(projectRoot, "public", "index.html"))) return true;

  return false;
}

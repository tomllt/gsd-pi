#!/usr/bin/env node
// Project/App: gsd-pi
// File Purpose: Per-unit pre-dispatch benchmark harness for issue #442.
//
// Exercises the hot path that runs before every auto-mode dispatch —
// reconcileBeforeDispatch (deriveState + drift detectors), detectStaleRenders
// (ROADMAP/PLAN markdown parsing) and preDispatchHealthGate (git shell-outs) —
// against a fixed fixture, then reports the debug-logger per-dispatch counters
// (deriveStateCalls, parseRoadmapCalls, parsePlanCalls, gitInvocations, ...).
//
// Phase 0 lands this harness + a committed baseline; each Phase 1 speed commit
// re-runs `--compare=<baseline>` to record its measured counter delta. The
// counters are RELATIVE (before/after on the same fixture), not absolute — see
// issue #442 notes on parse-counter double-counting.
//
// Run via the TS strip-types loader:
//   node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs \
//        --experimental-strip-types scripts/auto-dispatch-baseline.mjs [opts]
//
// Options:
//   --base=<path>        Run against an existing .gsd project (default: build a
//                        synthetic temp fixture — CI-reproducible).
//   --iterations=<n>     Dispatch passes to simulate (default 10).
//   --out=<path>         Where to write the baseline JSON (default:
//                        scripts/baselines/auto-dispatch-<gitsha>.json).
//   --compare=<file>     Diff this run against a saved baseline JSON and print
//                        per-counter deltas. Report-only (always exit 0).
//   --no-write           Don't write a baseline JSON (useful with --compare).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const GSD = "src/resources/extensions/gsd";

const {
  enableDebug,
  getDebugCounters,
  writeDebugSummary,
} = await import(`${REPO_ROOT}/${GSD}/debug-logger.ts`);
const {
  openDatabase,
  closeDatabase,
  insertMilestone,
  insertSlice,
  insertTask,
} = await import(`${REPO_ROOT}/${GSD}/gsd-db.ts`);
const { invalidateStateCache, resetDeriveTelemetry, getDeriveTelemetry } = await import(
  `${REPO_ROOT}/${GSD}/state.ts`
);
const { reconcileBeforeDispatch } = await import(`${REPO_ROOT}/${GSD}/state-reconciliation.ts`);
const { detectStaleRenders } = await import(`${REPO_ROOT}/${GSD}/markdown-renderer.ts`);
const { preDispatchHealthGate } = await import(`${REPO_ROOT}/${GSD}/doctor-proactive.ts`);

// ─── args ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { iterations: 10, base: null, out: null, compare: null, write: true };
  for (const a of argv) {
    if (a.startsWith("--base=")) opts.base = a.slice("--base=".length);
    else if (a.startsWith("--iterations=")) opts.iterations = Number(a.slice("--iterations=".length));
    else if (a.startsWith("--out=")) opts.out = a.slice("--out=".length);
    else if (a.startsWith("--compare=")) opts.compare = a.slice("--compare=".length);
    else if (a === "--no-write") opts.write = false;
  }
  return opts;
}

function gitSha() {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
    let dirty = "";
    try {
      const status = execFileSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
      if (status) dirty = "-dirty";
    } catch { /* ignore */ }
    return sha + dirty;
  } catch {
    return "unknown";
  }
}

// ─── synthetic fixture ────────────────────────────────────────────────────────
// Mirrors the proven fixture in
// src/resources/extensions/gsd/tests/state-reconciliation-drift.test.ts so the
// reconcile + stale-render + health-gate hot path all have real work to do.

function roadmapMd(slices) {
  const lines = ["# M001 Roadmap", "", "**Vision:** Benchmark fixture", "", "## Slices", ""];
  for (const s of slices) lines.push(`- ${s.done ? "[x]" : "[ ]"} **${s.id}: ${s.title}** \`risk:medium\` \`depends:[]\``);
  lines.push("");
  return lines.join("\n");
}

function planMd(sliceId, tasks) {
  const lines = [`# ${sliceId}: Benchmark Slice`, "", "**Goal:** bench", "**Demo:** demo", "", "## Must-Haves", "", "- Works", "", "## Tasks", ""];
  for (const t of tasks) lines.push(`- ${t.done ? "[x]" : "[ ]"} **${t.id}: ${t.title}** \`est:1h\``);
  lines.push("");
  return lines.join("\n");
}

function buildSyntheticFixture() {
  const base = mkdtempSync(join(tmpdir(), "gsd-auto-dispatch-baseline-"));
  const sliceDir = join(base, ".gsd", "milestones", "M001", "slices", "S01");
  mkdirSync(join(sliceDir, "tasks"), { recursive: true });

  // The health gate shells out to git, so the fixture must be a real repo.
  const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "bench", GIT_AUTHOR_EMAIL: "bench@x", GIT_COMMITTER_NAME: "bench", GIT_COMMITTER_EMAIL: "bench@x" };
  const git = (args) => execFileSync("git", args, { cwd: base, env: gitEnv, stdio: "ignore" });
  git(["init", "-q"]);
  git(["checkout", "-q", "-b", "main"]);

  openDatabase(join(base, ".gsd", "gsd.db"));
  insertMilestone({ id: "M001", title: "Bench Milestone", status: "active" });
  insertSlice({ id: "S01", milestoneId: "M001", title: "Bench Slice", status: "active", risk: "medium", depends: [], sequence: 1 });
  insertSlice({ id: "S02", milestoneId: "M001", title: "Second Slice", status: "pending", risk: "low", depends: [], sequence: 2 });
  insertTask({ id: "T01", sliceId: "S01", milestoneId: "M001", title: "First task", status: "active" });
  insertTask({ id: "T02", sliceId: "S01", milestoneId: "M001", title: "Second task", status: "pending" });

  writeFileSync(
    join(base, ".gsd", "milestones", "M001", "M001-ROADMAP.md"),
    roadmapMd([{ id: "S01", title: "Bench Slice", done: false }, { id: "S02", title: "Second Slice", done: false }]),
  );
  writeFileSync(
    join(sliceDir, "S01-PLAN.md"),
    planMd("S01", [{ id: "T01", title: "First task", done: false }, { id: "T02", title: "Second task", done: false }]),
  );

  git(["add", "-A"]);
  git(["commit", "-q", "-m", "bench fixture"]);
  return base;
}

// ─── run ──────────────────────────────────────────────────────────────────────

async function runDispatchPass(base) {
  // Each stage is tolerant: a stage that throws on the fixture must not abort
  // the whole benchmark — the counters from the stages that did run still count.
  try { invalidateStateCache(); await reconcileBeforeDispatch(base); } catch (e) { recordStageError("reconcile", e); }
  try { detectStaleRenders(base); } catch (e) { recordStageError("staleRenders", e); }
  try { await preDispatchHealthGate(base); } catch (e) { recordStageError("healthGate", e); }
}

const _stageErrors = {};
function recordStageError(stage, err) {
  _stageErrors[stage] = (_stageErrors[stage] ?? 0) + 1;
  if (_stageErrors[stage] === 1) {
    console.warn(`  ⚠ stage "${stage}" threw (counted once): ${err?.message ?? err}`);
  }
}

function perIteration(counters, iterations) {
  const out = {};
  for (const [k, v] of Object.entries(counters)) {
    out[k] = typeof v === "number" ? Math.round((v / iterations) * 100) / 100 : v;
  }
  return out;
}

function printTable(title, perIter, totals, iterations) {
  console.log(`\n${title} (${iterations} iterations)`);
  const keys = ["deriveStateCalls", "parseRoadmapCalls", "parsePlanCalls", "gitInvocations", "dispatches", "renders"];
  console.log("  counter             per-dispatch    total");
  for (const k of keys) {
    console.log(`  ${k.padEnd(20)}${String(perIter[k] ?? 0).padStart(10)}${String(totals[k] ?? 0).padStart(12)}`);
  }
  console.log(`  ${"dbDeriveCount".padEnd(20)}${String(perIter.dbDeriveCount ?? 0).padStart(10)}${String(totals.dbDeriveCount ?? 0).padStart(12)}`);
}

function printComparison(currentPerIter, baselineFile) {
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselineFile, "utf-8"));
  } catch (e) {
    console.error(`\n✗ could not read baseline ${baselineFile}: ${e?.message ?? e}`);
    return;
  }
  const basePerIter = baseline.perDispatch ?? {};
  console.log(`\nComparison vs ${baselineFile} (baseline sha ${baseline.gitSha ?? "?"})`);
  console.log("  counter             baseline     current      delta");
  const keys = ["deriveStateCalls", "parseRoadmapCalls", "parsePlanCalls", "gitInvocations", "dbDeriveCount"];
  for (const k of keys) {
    const b = basePerIter[k] ?? 0;
    const c = currentPerIter[k] ?? 0;
    const d = Math.round((c - b) * 100) / 100;
    const arrow = d < 0 ? "▼" : d > 0 ? "▲" : " ";
    console.log(`  ${k.padEnd(20)}${String(b).padStart(9)}${String(c).padStart(12)}${String(d).padStart(11)} ${arrow}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const usingSynthetic = !opts.base;
  const base = opts.base ? resolve(opts.base) : buildSyntheticFixture();
  if (opts.base && !existsSync(join(base, ".gsd"))) {
    console.error(`✗ --base=${base} has no .gsd directory`);
    process.exit(2);
  }
  console.log(`Benchmark target: ${base}${usingSynthetic ? " (synthetic fixture)" : ""}`);

  try {
    if (opts.base) {
      // An existing project may already have its DB open via a prior import;
      // open it for our query helpers.
      openDatabase(join(base, ".gsd", "gsd.db"));
    }
    enableDebug(base);
    resetDeriveTelemetry();

    for (let i = 0; i < opts.iterations; i++) {
      await runDispatchPass(base);
    }

    const counters = { ...getDebugCounters(), dbDeriveCount: getDeriveTelemetry().dbDeriveCount };
    writeDebugSummary();

    const perIter = perIteration(counters, opts.iterations);
    printTable("Per-dispatch pre-dispatch counters", perIter, counters, opts.iterations);
    if (Object.keys(_stageErrors).length) {
      console.log(`  (stage errors: ${JSON.stringify(_stageErrors)})`);
    }

    const record = {
      schema: "auto-dispatch-baseline/v1",
      gitSha: gitSha(),
      iterations: opts.iterations,
      fixture: usingSynthetic ? "synthetic" : base,
      totals: counters,
      perDispatch: perIter,
      stageErrors: _stageErrors,
    };

    if (opts.compare) printComparison(perIter, opts.compare);

    if (opts.write) {
      const outPath = opts.out
        ? resolve(opts.out)
        : join(REPO_ROOT, "scripts", "baselines", `auto-dispatch-${record.gitSha}.json`);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");
      console.log(`\n✓ wrote ${outPath}`);
    }
  } finally {
    try { closeDatabase(); } catch { /* noop */ }
    if (usingSynthetic) {
      try { rmSync(base, { recursive: true, force: true }); } catch { /* noop */ }
    }
  }
}

await main();

/**
 * Live workflow: tiny pre-seeded milestone, real agent, single-unit dispatch.
 *
 * Seeds a one-slice/one-task milestone whose task is "make answer() return
 * 42" (the bundled test fails until then), then dispatches ONE unit with
 * `gsd headless next` — a real agent turn that edits the code and passes the
 * host-owned verification gate, after which step-mode exits 0. We use `next`
 * rather than `auto` deliberately: `auto` would loop into milestone closeout,
 * which is built around human-gated checkpoints that don't resolve in
 * non-supervised headless mode (the agent's closeout turn hangs with no
 * output). `next` exercises the real agent through the real dispatch +
 * verification gates without that interactive tail.
 *
 * Proof is durable only — never agent prose: exit code + the task's own
 * verification command + git history.
 *
 * Exit: 0 pass · 77 skip (no creds) · non-zero fail.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import { artifactsFor, createTmpProject } from "../e2e/_shared/index.ts";
import {
  credentialNames,
  hasUsableCredentials,
  liveEnv,
  runStreaming,
  runVerification,
  seedTinyMilestone,
} from "./harness.ts";

function skip(reason: string): never {
  console.log(`SKIPPED: ${reason}`);
  process.exit(77);
}

if (process.env.GSD_LIVE_TESTS !== "1") skip("set GSD_LIVE_TESTS=1 to enable");
if (!hasUsableCredentials()) {
  skip("no provider credentials in env (export a *_API_KEY or *_OAUTH_TOKEN)");
}
console.log(`Credentials: ${credentialNames().join(", ")}`);

const model = process.env.GSD_LIVE_WORKFLOW_MODEL?.trim();
const autoTimeoutMs = Number(process.env.GSD_LIVE_WORKFLOW_TIMEOUT_MS ?? 300_000);

const project = createTmpProject({ git: true });
const artifacts = artifactsFor("live-tiny-milestone");

try {
  const { verifyArgv } = seedTinyMilestone(project);

  // Sanity: the fixture must actually be broken before the agent runs,
  // otherwise a no-op agent would "pass" the durable assertion.
  const before = runVerification(project, verifyArgv);
  assert.equal(before.ok, false, `fixture should fail before the agent runs, but it passed:\n${before.output}`);

  const commitsBefore = Number(
    execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: project.dir, encoding: "utf8" }).trim(),
  );

  // Dispatch a single unit (execute-task T01) via `next`. Default to text+verbose
  // so the agent's work renders as a READABLE transcript (gsd's own formatProgress
  // renderer); set GSD_LIVE_WORKFLOW_OUTPUT=stream-json for machine-parseable JSONL.
  const outputFormat = process.env.GSD_LIVE_WORKFLOW_OUTPUT?.trim() || "text";
  const dispatchArgs = [
    "headless",
    "--output-format",
    outputFormat,
    ...(outputFormat === "text" ? ["--verbose"] : []),
    "--timeout",
    String(autoTimeoutMs),
    "--max-restarts",
    "0",
    ...(model ? ["--model", model] : []),
    "next",
  ];
  console.log(`Running: gsd ${dispatchArgs.join(" ")}${model ? "" : " (model auto-resolved from available credentials)"}`);
  console.log("─── live transcript ─────────────────────────────────────────");

  // Stream the readable transcript to the terminal live, while still capturing it.
  // This wall-clock budget (gsd timeout + a small grace) is the authoritative
  // limit on the run.
  const result = await runStreaming(dispatchArgs, {
    cwd: project.dir,
    timeoutMs: autoTimeoutMs + 30_000,
    env: liveEnv(),
  });
  console.log("─── end transcript ──────────────────────────────────────────");

  // Save a clean, ANSI-stripped transcript plus the raw streams for post-mortem.
  const transcript = [result.stdoutClean, result.stderrClean].filter((s) => s.trim()).join("\n");
  artifacts.write("transcript.txt", transcript);
  artifacts.write("dispatch.stdout.log", result.stdout);
  artifacts.write("dispatch.stderr.log", result.stderr);
  console.log(`exit code: ${result.code} (0=success, 10=blocked, 1=error/timeout, 11=cancelled)`);
  console.log(`transcript: ${artifacts.dir}/transcript.txt`);

  assert.ok(!result.timedOut, "unit dispatch hit the harness timeout — raise GSD_LIVE_WORKFLOW_TIMEOUT_MS");
  assert.equal(
    result.code,
    0,
    `expected the dispatched unit to complete (exit 0), got ${result.code}. See ${artifacts.dir}/transcript.txt`,
  );
  assert.ok(transcript.trim().length > 0, "expected the unit dispatch to produce a transcript");

  // Durable proof #1: the task's own verification now passes.
  const after = runVerification(project, verifyArgv);
  assert.ok(after.ok, `verification still fails — the agent did not complete the task:\n${after.output}`);

  // Durable proof #2: the agent committed its work.
  const commitsAfter = Number(
    execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: project.dir, encoding: "utf8" }).trim(),
  );
  assert.ok(
    commitsAfter > commitsBefore,
    `expected the agent to add at least one commit (before=${commitsBefore}, after=${commitsAfter})`,
  );

  console.log("PASS: live agent completed the dispatched task and verification passes.");
} finally {
  project.cleanup();
}

import test from "node:test";
import assert from "node:assert/strict";

import { registerExecTools } from "../bootstrap/exec-tools.ts";
import { executeUatExec } from "../tools/exec-tool.ts";
import type { ExecSandboxRequest, ExecSandboxResult } from "../exec-sandbox.ts";

function makeExecResult(request: ExecSandboxRequest): ExecSandboxResult {
  return {
    id: "exec-1",
    runtime: request.runtime,
    exit_code: 0,
    signal: null,
    timed_out: false,
    duration_ms: 1,
    stdout_bytes: 12,
    stderr_bytes: 0,
    stdout_truncated: false,
    stderr_truncated: false,
    stdout_path: ".gsd/exec/exec-1.stdout",
    stderr_path: ".gsd/exec/exec-1.stderr",
    meta_path: ".gsd/exec/exec-1.meta.json",
    digest: "check passed",
  };
}

test("executeUatExec accepts evidence-mode aliases for intent", async () => {
  const requests: ExecSandboxRequest[] = [];
  const result = await executeUatExec(
    {
      milestoneId: "M001",
      sliceId: "S01",
      checkId: "UAT-PRE",
      intent: "artifact",
      runtime: "bash",
      script: "printf ok",
    },
    {
      baseDir: "/tmp/gsd-uat-exec-test",
      preferences: null,
      run: async (request) => {
        requests.push(request);
        return makeExecResult(request);
      },
    },
  );

  assert.equal(result.isError, false);
  assert.equal(result.details?.operation, "gsd_uat_exec");
  assert.equal(result.details?.intent, "uat-artifact-check");
  assert.equal(requests[0]?.metadata?.intent, "uat-artifact-check");
});

test("registerExecTools exposes gsd_uat_exec intent as recoverable string schema", () => {
  const tools: Array<{ name: string; parameters: any }> = [];
  registerExecTools({
    registerTool: (tool: { name: string; parameters: any }) => {
      tools.push(tool);
    },
  } as any);

  const tool = tools.find((registeredTool) => registeredTool.name === "gsd_uat_exec");
  assert.ok(tool, "gsd_uat_exec should be registered");
  const intentSchema = tool.parameters.properties.intent;
  assert.equal(intentSchema.type, "string");
  assert.equal("anyOf" in intentSchema, false);
  assert.match(intentSchema.description, /uat-artifact-check/);
  assert.match(intentSchema.description, /artifact/);
});

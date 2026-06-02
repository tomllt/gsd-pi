import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { registerHooks } from "../bootstrap/register-hooks.ts";
import {
  getPendingGate,
  resetWriteGateState,
  shouldBlockContextArtifactSave,
} from "../bootstrap/write-gate.ts";
import { classifyCommand } from "../safety/destructive-guard.ts";
import { toRoundResultResponse } from "../../remote-questions/manager.ts";

function makeTempDir(prefix: string): string {
  const dir = join(
    tmpdir(),
    `gsd-depth-gate-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function armDepthGate(
  handlers: Map<string, Array<(event: any, ctx?: any) => Promise<any> | any>>,
  toolName: string,
  questions: unknown[],
): Promise<void> {
  const input = { questions };
  for (const handler of handlers.get("tool_call") ?? []) {
    await handler({ toolName, input });
  }
  for (const handler of handlers.get("tool_execution_start") ?? []) {
    await handler({ toolName, args: input });
  }
}

test("destructive guard classifies infrastructure mutation commands", () => {
  assert.deepEqual(classifyCommand("terraform destroy -auto-approve").labels, ["IaC apply/destroy"]);
  assert.deepEqual(classifyCommand("terragrunt apply").labels, ["IaC apply/destroy"]);
  assert.deepEqual(classifyCommand("aws s3 delete-bucket --bucket example").labels, ["AWS mutation"]);
  assert.deepEqual(classifyCommand("kubectl delete namespace prod").labels, ["kubectl mutation"]);
});

test("register-hooks hard-blocks destructive bash commands outside auto-mode", async () => {
  const handlers = new Map<string, Array<(event: any, ctx?: any) => Promise<any> | any>>();
  const pi = {
    on(event: string, handler: (event: any, ctx?: any) => Promise<any> | any) {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
  } as any;

  registerHooks(pi, []);

  let block: any;
  for (const handler of handlers.get("tool_call") ?? []) {
    const result = await handler({
      toolCallId: "call-1",
      toolName: "bash",
      input: { command: "terraform apply -auto-approve" },
    });
    if (result?.block) block = result;
  }

  assert.equal(block?.block, true);
  assert.match(block?.reason ?? "", /HARD BLOCK: destructive Bash command requires explicit human confirmation/);
  assert.match(block?.reason ?? "", /IaC apply\/destroy/);
});

test("register-hooks unlocks milestone depth verification from question id without guided-flow state (#4047)", async (t) => {
  const dir = makeTempDir("manual");
  const originalCwd = process.cwd();
  process.chdir(dir);
  resetWriteGateState(dir);

  t.after(() => {
    try {
      resetWriteGateState(dir);
    } finally {
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const handlers = new Map<string, Array<(event: any, ctx?: any) => Promise<void> | void>>();
  const pi = {
    on(event: string, handler: (event: any, ctx?: any) => Promise<void> | void) {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
  } as any;

  registerHooks(pi, []);

  const questionId = "depth_verification_M001_confirm";
  const questions = [
    {
      id: questionId,
      question: "Do you agree?",
      options: [
        { label: "Yes, you got it (Recommended)" },
        { label: "Needs adjustment" },
      ],
    },
  ];

  const toolResultHandlers = handlers.get("tool_result");
  assert.ok(toolResultHandlers?.length, "tool_result handler should be registered");

  await armDepthGate(handlers, "ask_user_questions", questions);

  assert.equal(getPendingGate(), questionId, "gate should be set even without guided-flow state");
  assert.equal(
    shouldBlockContextArtifactSave("CONTEXT", "M001").block,
    true,
    "milestone context should still be blocked before confirmation",
  );

  for (const handler of toolResultHandlers ?? []) {
    await handler({
      toolName: "ask_user_questions",
      input: { questions },
      details: {
        response: {
          answers: {
            [questionId]: { selected: "Yes, you got it (Recommended)" },
          },
        },
      },
    });
  }

  assert.equal(getPendingGate(), null, "confirming the depth question should clear the pending gate");
  assert.equal(
    shouldBlockContextArtifactSave("CONTEXT", "M001").block,
    false,
    "question-id milestone inference should unlock the matching milestone context write",
  );
});

test("register-hooks clears depth gate when remote (Telegram/Slack/Discord) answer is normalized (#4406)", async (t) => {
  const dir = makeTempDir("remote");
  const originalCwd = process.cwd();
  process.chdir(dir);
  resetWriteGateState(dir);

  t.after(() => {
    try {
      resetWriteGateState(dir);
    } finally {
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const handlers = new Map<string, Array<(event: any, ctx?: any) => Promise<void> | void>>();
  const pi = {
    on(event: string, handler: (event: any, ctx?: any) => Promise<void> | void) {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
  } as any;

  registerHooks(pi, []);

  const questionId = "depth_verification_M002_confirm";
  const questions = [
    {
      id: questionId,
      question: "Do you agree?",
      options: [
        { label: "Yes, you got it (Recommended)" },
        { label: "Needs adjustment" },
      ],
    },
  ];

  await armDepthGate(handlers, "ask_user_questions", questions);
  assert.equal(getPendingGate(), questionId);

  // Simulate the normalized response the remote manager now emits:
  // a Telegram button press returns a RemoteAnswer that is fed through
  // toRoundResultResponse before reaching details.response.
  const remoteAnswer = {
    answers: {
      [questionId]: { answers: ["Yes, you got it (Recommended)"] },
    },
  };
  const normalized = toRoundResultResponse(remoteAnswer);

  for (const handler of handlers.get("tool_result") ?? []) {
    await handler({
      toolName: "ask_user_questions",
      input: { questions },
      details: { response: normalized },
    });
  }

  assert.equal(getPendingGate(), null, "normalized remote answer must clear the gate");
  assert.equal(
    shouldBlockContextArtifactSave("CONTEXT", "M002").block,
    false,
    "remote confirmation must unlock the matching milestone context write",
  );
});

test("register-hooks returns hard blocker when depth question is cancelled", async (t) => {
  const dir = makeTempDir("cancelled");
  const originalCwd = process.cwd();
  process.chdir(dir);
  resetWriteGateState(dir);

  t.after(() => {
    try {
      resetWriteGateState(dir);
    } finally {
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const handlers = new Map<string, Array<(event: any, ctx?: any) => Promise<any> | any>>();
  const pi = {
    on(event: string, handler: (event: any, ctx?: any) => Promise<any> | any) {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
  } as any;

  registerHooks(pi, []);

  const questionId = "depth_verification_M003_confirm";
  const questions = [
    {
      id: questionId,
      question: "Did I capture this correctly?",
      options: [
        { label: "Yes, you got it (Recommended)" },
        { label: "Needs adjustment" },
      ],
    },
  ];

  await armDepthGate(handlers, "ask_user_questions", questions);
  assert.equal(getPendingGate(), questionId);

  let patch: any;
  for (const handler of handlers.get("tool_result") ?? []) {
    const result = await handler({
      toolName: "ask_user_questions",
      input: { questions },
      details: { cancelled: true, response: null },
    });
    if (result) patch = result;
  }

  assert.equal(getPendingGate(), questionId, "cancelled question must leave gate pending");
  assert.match(
    patch?.content?.[0]?.text ?? "",
    /Waiting for depth confirmation on gate "depth_verification_M003_confirm"/,
  );
  assert.match(
    patch?.content?.[0]?.text ?? "",
    /Do not infer approval from earlier or prior messages/,
  );
  assert.match(
    patch?.content?.[0]?.text ?? "",
    /Re-call ask_user_questions with the same gate question id/,
    "must instruct the agent to re-ask via ask_user_questions",
  );
  assert.doesNotMatch(
    patch?.content?.[0]?.text ?? "",
    /confirm in plain chat, then stop/,
    "must not direct the agent down the prior dead-end plain-chat-and-stop path",
  );
});

test("register-hooks clears deferred approval gate after depth confirmation (headless e2e regression)", async (t) => {
  const dir = makeTempDir("deferred-clear");
  const originalCwd = process.cwd();
  process.chdir(dir);
  resetWriteGateState(dir);

  t.after(() => {
    try {
      resetWriteGateState(dir);
    } finally {
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const handlers = new Map<string, Array<(event: any, ctx?: any) => Promise<any> | any>>();
  const pi = {
    on(event: string, handler: (event: any, ctx?: any) => Promise<any> | any) {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
  } as any;

  registerHooks(pi, []);

  const questionId = "depth_verification_M001_confirm";
  const questions = [
    {
      id: questionId,
      question: "Proceed with this headless milestone plan?",
      options: [
        { label: "Yes, you got it (Recommended)" },
        { label: "Not quite" },
      ],
    },
  ];

  await armDepthGate(handlers, "ask_user_questions", questions);

  // message_update can re-arm defer after execution_start cleared it.
  for (const handler of handlers.get("tool_call") ?? []) {
    await handler({ toolName: "ask_user_questions", input: { questions } });
  }

  for (const handler of handlers.get("tool_result") ?? []) {
    await handler({
      toolName: "ask_user_questions",
      input: { questions },
      details: {
        response: {
          answers: {
            [questionId]: { selected: "Yes, you got it (Recommended)" },
          },
        },
      },
    });
  }

  let contextBlock: { block?: boolean; reason?: string } | undefined;
  for (const handler of handlers.get("tool_call") ?? []) {
    contextBlock = await handler({
      toolName: "gsd_summary_save",
      input: {
        milestone_id: "M001",
        artifact_type: "CONTEXT",
        content: "# M001 Context\n",
      },
    });
  }

  assert.notEqual(
    contextBlock?.block,
    true,
    "context save must not stay blocked by deferred approval gate after confirmation",
  );
  assert.equal(
    shouldBlockContextArtifactSave("CONTEXT", "M001").block,
    false,
    "depth verification should unlock milestone context writes",
  );
});

test("register-hooks recovers from a cancelled depth question via re-asked ask_user_questions (milestone-hang regression)", async (t) => {
  const dir = makeTempDir("recovery");
  const originalCwd = process.cwd();
  process.chdir(dir);
  resetWriteGateState(dir);

  t.after(() => {
    try {
      resetWriteGateState(dir);
    } finally {
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const handlers = new Map<string, Array<(event: any, ctx?: any) => Promise<any> | any>>();
  const pi = {
    on(event: string, handler: (event: any, ctx?: any) => Promise<any> | any) {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
  } as any;

  registerHooks(pi, []);

  const questionId = "depth_verification_M001_confirm";
  const questions = [
    {
      id: questionId,
      question: "Did I capture the project correctly?",
      options: [
        { label: "Yes, you got it (Recommended)" },
        { label: "Not quite — let me clarify" },
      ],
    },
  ];

  // 1. Initial ask sets the gate.
  await armDepthGate(handlers, "ask_user_questions", questions);
  assert.equal(getPendingGate(), questionId, "initial ask must set the gate");

  // 2. User cancels (simulates the trap from the screenshot: question never
  //    answered through the structured channel). Gate must stay pending.
  for (const handler of handlers.get("tool_result") ?? []) {
    await handler({
      toolName: "ask_user_questions",
      input: { questions },
      details: { cancelled: true, response: null },
    });
  }
  assert.equal(getPendingGate(), questionId, "cancelled response must leave gate pending");

  // 3. Recovery path: immediately re-call ask_user_questions with the same
  //    gate id and identical input. This must not be blocked by the strict
  //    duplicate-call loop guard, because the hard-block instruction above
  //    tells the agent to do exactly this and not to interleave other tools.
  const reaskBlocks: any[] = [];
  for (const handler of handlers.get("tool_call") ?? []) {
    const result = await handler({ toolName: "ask_user_questions", input: { questions } });
    if (result?.block) reaskBlocks.push(result);
  }
  assert.equal(
    reaskBlocks.length,
    0,
    "immediate identical re-ask must not be blocked by the tool-call loop guard",
  );

  // 4. The re-asked question receives a confirming response, which clears the
  //    gate and unlocks the milestone context save.
  for (const handler of handlers.get("tool_execution_start") ?? []) {
    await handler({ toolName: "ask_user_questions", args: { questions } });
  }
  for (const handler of handlers.get("tool_result") ?? []) {
    await handler({
      toolName: "ask_user_questions",
      input: { questions },
      details: {
        response: {
          answers: {
            [questionId]: { selected: "Yes, you got it (Recommended)" },
          },
        },
      },
    });
  }

  assert.equal(getPendingGate(), null, "confirming re-ask must clear the gate");
  assert.equal(
    shouldBlockContextArtifactSave("CONTEXT", "M001").block,
    false,
    "context save must unlock after recovery",
  );
});

test("register-hooks gates MCP ask_user_questions cancellation before requirement saves", async (t) => {
  const dir = makeTempDir("mcp-cancelled");
  const originalCwd = process.cwd();
  process.chdir(dir);
  resetWriteGateState(dir);

  t.after(() => {
    try {
      resetWriteGateState(dir);
    } finally {
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const handlers = new Map<string, Array<(event: any, ctx?: any) => Promise<any> | any>>();
  const pi = {
    on(event: string, handler: (event: any, ctx?: any) => Promise<any> | any) {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
  } as any;

  registerHooks(pi, []);

  const questionId = "depth_verification_requirements_confirm";
  const questions = [
    {
      id: questionId,
      question: "Are these the right requirements at the right scope?",
      options: [
        { label: "Yes, ship it (Recommended)" },
        { label: "Not quite — let me adjust" },
      ],
    },
  ];

  const askBlocks: any[] = [];
  for (const handler of handlers.get("tool_call") ?? []) {
    const result = await handler({
      toolName: "mcp__gsd-workflow__ask_user_questions",
      input: { questions },
    });
    if (result) askBlocks.push(result);
  }

  assert.equal(getPendingGate(), null, "MCP ask_user_questions should defer the gate until execution starts");
  assert.equal(
    askBlocks.some((result) => result?.block === true),
    false,
    "the gate-setting MCP ask_user_questions call itself should be allowed",
  );

  for (const handler of handlers.get("tool_execution_start") ?? []) {
    await handler({
      toolName: "mcp__gsd-workflow__ask_user_questions",
      args: { questions },
    });
  }
  assert.equal(getPendingGate(), questionId, "execution start should activate the pending gate");

  let hardBlock: any;
  for (const handler of handlers.get("tool_result") ?? []) {
    const result = await handler({
      toolName: "mcp__gsd-workflow__ask_user_questions",
      input: { questions },
      details: { cancelled: true, response: null },
    });
    if (result) hardBlock = result;
  }

  assert.equal(getPendingGate(), questionId, "cancelled MCP question must leave gate pending");
  assert.match(
    hardBlock?.content?.[0]?.text ?? "",
    /Waiting for depth confirmation on gate "depth_verification_requirements_confirm"/,
  );

  let toolSearchBlock: any;
  for (const handler of handlers.get("tool_call") ?? []) {
    const result = await handler({
      toolName: "ToolSearch",
      input: { query: "select:mcp__gsd-workflow__gsd_requirement_save", max_results: 2 },
    });
    if (result?.block) toolSearchBlock = result;
  }
  assert.equal(toolSearchBlock?.block, true, "ToolSearch must not bury a pending approval question");

  let requirementBlock: any;
  for (const handler of handlers.get("tool_call") ?? []) {
    const result = await handler({
      toolName: "mcp__gsd-workflow__gsd_requirement_save",
      input: {
        class: "functional",
        description: "User can add tasks to the todo list",
        why: "Primary product value",
        source: "primary-user-loop",
      },
    });
    if (result?.block) requirementBlock = result;
  }

  assert.equal(requirementBlock?.block, true, "requirement save must be blocked while gate is pending");
  assert.match(requirementBlock?.reason ?? "", /has not been confirmed/);
});

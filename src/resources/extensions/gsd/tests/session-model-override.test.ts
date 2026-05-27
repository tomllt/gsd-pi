import test from "node:test";
import assert from "node:assert/strict";

import {
  clearSessionModelOverride,
  getSessionModelOverride,
  setSessionModelOverride,
} from "../session-model-override.js";
import { cleanupAfterLoopExit } from "../auto.js";
import { autoSession } from "../auto-runtime-state.js";

test("setSessionModelOverride stores provider/model for the session", () => {
  const sessionId = `session-override-${Date.now()}`;
  setSessionModelOverride(sessionId, { provider: "openai-codex", id: "gpt-5.4" });

  const override = getSessionModelOverride(sessionId);
  assert.equal(override?.provider, "openai-codex");
  assert.equal(override?.id, "gpt-5.4");
});

test("clearSessionModelOverride removes the session override", () => {
  const sessionId = `session-clear-${Date.now()}`;
  setSessionModelOverride(sessionId, { provider: "anthropic", id: "claude-sonnet-4-6" });
  clearSessionModelOverride(sessionId);
  assert.equal(getSessionModelOverride(sessionId), undefined);
});

test("session model overrides are isolated by session id", () => {
  const first = `session-first-${Date.now()}`;
  const second = `session-second-${Date.now()}`;
  setSessionModelOverride(first, { provider: "openai-codex", id: "gpt-5.4" });
  setSessionModelOverride(second, { provider: "anthropic", id: "claude-sonnet-4-6" });

  assert.deepEqual(getSessionModelOverride(first), {
    provider: "openai-codex",
    id: "gpt-5.4",
  });
  assert.deepEqual(getSessionModelOverride(second), {
    provider: "anthropic",
    id: "claude-sonnet-4-6",
  });
});

test("cleanupAfterLoopExit clears auto model override for the command session", async (t) => {
  const sessionId = `session-auto-cleanup-${Date.now()}`;
  autoSession.reset();
  autoSession.active = true;
  autoSession.cmdCtx = {
    sessionManager: { getSessionId: () => sessionId },
  } as any;
  setSessionModelOverride(sessionId, { provider: "openai-codex", id: "gpt-5.4" });

  t.after(() => {
    autoSession.reset();
    clearSessionModelOverride(sessionId);
  });

  await cleanupAfterLoopExit({
    hasUI: false,
    ui: {
      setStatus: () => {},
      setWidget: () => {},
    },
  } as any);

  assert.equal(getSessionModelOverride(sessionId), undefined);
});

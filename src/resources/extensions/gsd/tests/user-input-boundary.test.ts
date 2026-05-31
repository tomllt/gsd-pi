import test from "node:test";
import assert from "node:assert/strict";

import * as userInputBoundary from "../user-input-boundary.ts";

test("lastAssistantText extracts the latest assistant text block content", () => {
  const lastAssistantText = (userInputBoundary as {
    lastAssistantText?: (messages: unknown[] | null | undefined) => string;
  }).lastAssistantText;

  assert.equal(typeof lastAssistantText, "function");
  assert.equal(
    lastAssistantText?.([
      { role: "assistant", content: "Older message" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "First line" },
          { type: "text", text: "Second line" },
        ],
      },
    ]),
    "First line\nSecond line",
  );
  assert.equal(lastAssistantText?.(null), "");
});

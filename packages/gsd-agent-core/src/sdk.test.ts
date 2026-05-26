import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  createCodingTools,
  createReadOnlyTools,
  createAgentSession,
} from "./sdk.ts";
import { AgentSession } from "./agent-session.ts";

describe("@gsd/agent-core sdk exports", () => {
  test("exports session factory and tool factories", () => {
    assert.equal(typeof createAgentSession, "function");
    assert.equal(typeof AgentSession, "function");
    assert.equal(typeof createCodingTools, "function");
    assert.equal(typeof createReadOnlyTools, "function");
  });

  test("createReadOnlyTools excludes mutating tools by default", () => {
    const tools = createReadOnlyTools("/tmp");
    const names = tools.map((tool) => tool.name);
    assert.ok(names.includes("read"));
    assert.ok(names.includes("grep"));
    assert.equal(names.includes("write"), false);
    assert.equal(names.includes("edit"), false);
  });
});

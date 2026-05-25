import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOUD_GATEWAY_TOOL_NAMES } from "./mcp.js";

test("gateway advertises the unified project graph MCP tool", () => {
  assert.ok(CLOUD_GATEWAY_TOOL_NAMES.includes("gsd_graph"));
  assert.equal(CLOUD_GATEWAY_TOOL_NAMES.some((name) => name.startsWith("gsd_graph_")), false);
});

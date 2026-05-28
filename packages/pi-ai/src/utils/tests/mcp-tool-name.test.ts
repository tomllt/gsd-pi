import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseMcpToolName, stripMcpToolPrefix } from "../mcp-tool-name.js";
import { CLAUDE_CODE_TOOL_ALIASES, resolveAgentToolName } from "../tool-shims.js";

describe("mcp-tool-name", () => {
	test("parseMcpToolName splits server and tool", () => {
		assert.deepEqual(parseMcpToolName("mcp__gsd-workflow__gsd_plan_milestone"), {
			server: "gsd-workflow",
			tool: "gsd_plan_milestone",
		});
	});

	test("stripMcpToolPrefix returns canonical tool name", () => {
		assert.equal(stripMcpToolPrefix("mcp__gsd-workflow__gsd_milestone_status"), "gsd_milestone_status");
		assert.equal(stripMcpToolPrefix("read"), "read");
	});
});

describe("resolveAgentToolName", () => {
	test("maps Claude Code Grep to Pi grep when registered", () => {
		assert.equal(CLAUDE_CODE_TOOL_ALIASES.grep, "grep");
		assert.equal(resolveAgentToolName("Grep"), "grep");
	});

	test("maps Claude Code Glob to Pi find", () => {
		assert.equal(CLAUDE_CODE_TOOL_ALIASES.glob, "find");
		assert.equal(resolveAgentToolName("Glob"), "find");
	});

	test("maps Claude Code WebFetch and WebSearch to Pi extensions", () => {
		assert.equal(resolveAgentToolName("WebFetch"), "fetch_page");
		assert.equal(resolveAgentToolName("WebSearch"), "search-the-web");
	});

	test("strips MCP prefixes", () => {
		assert.equal(resolveAgentToolName("mcp__gsd-workflow__gsd_exec"), "gsd_exec");
	});
});

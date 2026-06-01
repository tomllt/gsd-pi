import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
	createToolSearchShimResult,
	isToolSearchToolName,
	parseToolSearchSelectQuery,
} from "../tool-search-shim.js";

describe("tool-search-shim", () => {
	test("parseToolSearchSelectQuery extracts MCP tool name", () => {
		assert.equal(
			parseToolSearchSelectQuery("select:mcp__gsd-workflow__gsd_milestone_status"),
			"mcp__gsd-workflow__gsd_milestone_status",
		);
	});

	test("createToolSearchShimResult guides direct MCP call when that exact tool is active", () => {
		const result = createToolSearchShimResult({
			query: "select:mcp__gsd-workflow__gsd_milestone_status",
		}, {
			activeToolNames: ["mcp__gsd-workflow__gsd_milestone_status"],
		});
		assert.ok(result.content[0]?.text.includes("mcp__gsd-workflow__gsd_milestone_status"));
		assert.equal(result.details.resolvedTool, "mcp__gsd-workflow__gsd_milestone_status");
	});

	test("createToolSearchShimResult maps stale MCP aliases to the active scoped tool", () => {
		const result = createToolSearchShimResult({
			query: "select:mcp__gsd-workflow__gsd_milestone_status",
		}, {
			activeToolNames: ["mcp__custom-workflow__gsd_milestone_status"],
		});
		assert.ok(result.content[0]?.text.includes("mcp__custom-workflow__gsd_milestone_status"));
		assert.ok(!result.content[0]?.text.includes("Call `mcp__gsd-workflow__gsd_milestone_status`"));
		assert.equal(result.details.resolvedTool, "mcp__custom-workflow__gsd_milestone_status");
	});

	test("createToolSearchShimResult does not reinforce inactive MCP aliases", () => {
		const result = createToolSearchShimResult({
			query: "select:mcp__gsd-workflow__gsd_milestone_status",
		});
		assert.ok(result.content[0]?.text.includes("Do not call `mcp__gsd-workflow__gsd_milestone_status`"));
		assert.ok(!result.content[0]?.text.includes("Call `mcp__gsd-workflow__gsd_milestone_status`"));
		assert.equal(result.details.resolvedTool, "gsd_milestone_status");
	});

	test("createToolSearchShimResult avoids hard-coded workflow MCP aliases for canonical tools", () => {
		const result = createToolSearchShimResult({
			query: "select:gsd_milestone_status",
		});
		assert.ok(result.content[0]?.text.includes("Call `gsd_milestone_status` directly"));
		assert.ok(!result.content[0]?.text.includes("mcp__gsd-workflow__gsd_milestone_status"));
		assert.equal(result.details.resolvedTool, "gsd_milestone_status");
	});

	test("isToolSearchToolName is case insensitive", () => {
		assert.equal(isToolSearchToolName("ToolSearch"), true);
		assert.equal(isToolSearchToolName("toolsearch"), true);
		assert.equal(isToolSearchToolName("Read"), false);
	});
});

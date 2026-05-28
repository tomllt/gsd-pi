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

	test("createToolSearchShimResult guides direct MCP call", () => {
		const result = createToolSearchShimResult({
			query: "select:mcp__gsd-workflow__gsd_milestone_status",
		});
		assert.ok(result.content[0]?.text.includes("mcp__gsd-workflow__gsd_milestone_status"));
		assert.equal(result.details.resolvedTool, "mcp__gsd-workflow__gsd_milestone_status");
	});

	test("isToolSearchToolName is case insensitive", () => {
		assert.equal(isToolSearchToolName("ToolSearch"), true);
		assert.equal(isToolSearchToolName("toolsearch"), true);
		assert.equal(isToolSearchToolName("Read"), false);
	});
});

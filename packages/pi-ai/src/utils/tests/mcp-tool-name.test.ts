import { describe, expect, test } from "vitest";
import { parseMcpToolName, stripMcpToolPrefix } from "../mcp-tool-name.js";
import { CLAUDE_CODE_TOOL_ALIASES, resolveAgentToolName } from "../tool-shims.js";

describe("mcp-tool-name", () => {
	test("parseMcpToolName splits server and tool", () => {
		expect(parseMcpToolName("mcp__gsd-workflow__gsd_plan_milestone")).toEqual({
			server: "gsd-workflow",
			tool: "gsd_plan_milestone",
		});
	});

	test("stripMcpToolPrefix returns canonical tool name", () => {
		expect(stripMcpToolPrefix("mcp__gsd-workflow__gsd_milestone_status")).toBe("gsd_milestone_status");
		expect(stripMcpToolPrefix("read")).toBe("read");
	});
});

describe("resolveAgentToolName", () => {
	test("maps Claude Code Grep to Pi grep when registered", () => {
		expect(CLAUDE_CODE_TOOL_ALIASES.grep).toBe("grep");
		expect(resolveAgentToolName("Grep")).toBe("grep");
	});

	test("maps Claude Code Glob to Pi find", () => {
		expect(CLAUDE_CODE_TOOL_ALIASES.glob).toBe("find");
		expect(resolveAgentToolName("Glob")).toBe("find");
	});

	test("maps Claude Code WebFetch and WebSearch to Pi extensions", () => {
		expect(resolveAgentToolName("WebFetch")).toBe("fetch_page");
		expect(resolveAgentToolName("WebSearch")).toBe("search-the-web");
	});

	test("strips MCP prefixes", () => {
		expect(resolveAgentToolName("mcp__gsd-workflow__gsd_exec")).toBe("gsd_exec");
	});
});

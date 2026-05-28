import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
	createAgentShimResult,
	extractNormalizedSubagentCall,
	isAgentToolName,
	mapSubagentTypeToGsdAgent,
	normalizeClaudeCodeAgentArguments,
} from "../agent-shim.js";

describe("isAgentToolName", () => {
	test("matches Agent case-insensitively", () => {
		assert.equal(isAgentToolName("Agent"), true);
		assert.equal(isAgentToolName("agent"), true);
		assert.equal(isAgentToolName("subagent"), false);
	});
});

describe("mapSubagentTypeToGsdAgent", () => {
	test("maps Claude Code Explore to scout", () => {
		assert.equal(mapSubagentTypeToGsdAgent("Explore"), "scout");
	});

	test("maps general-purpose variants to worker", () => {
		assert.equal(mapSubagentTypeToGsdAgent("general-purpose"), "worker");
		assert.equal(mapSubagentTypeToGsdAgent("generalPurpose"), "worker");
	});
});

describe("normalizeClaudeCodeAgentArguments", () => {
	test("converts Agent args to subagent shape", () => {
		const args = {
			subagent_type: "Explore",
			description: "Scout current project state",
			prompt: "Read key files and summarize.",
		};
		normalizeClaudeCodeAgentArguments(args);
		assert.deepEqual(args, {
			agent: "scout",
			task: "Scout current project state\n\nRead key files and summarize.",
		});
	});

	test("prefers explicit task when present", () => {
		const args = {
			subagent_type: "Explore",
			task: "Existing task",
			prompt: "Ignored",
		};
		normalizeClaudeCodeAgentArguments(args);
		assert.deepEqual(args, {
			agent: "scout",
			task: "Existing task",
		});
	});

	test("removes case-varied subagent type keys after reading them", () => {
		const args = {
			SUBAGENT_TYPE: "Explore",
			prompt: "Inspect repository",
		};

		normalizeClaudeCodeAgentArguments(args);

		assert.deepEqual(args, {
			agent: "scout",
			task: "Inspect repository",
		});
	});
});

describe("extractNormalizedSubagentCall", () => {
	test("returns mapped agent and task", () => {
		assert.deepEqual(
			extractNormalizedSubagentCall({
				subagent_type: "Explore",
				description: "Scout",
				prompt: "Go",
			}),
			{ agent: "scout", task: "Scout\n\nGo" },
		);
	});
});

describe("createAgentShimResult", () => {
	test("returns non-error guidance when subagent is unavailable", () => {
		const result = createAgentShimResult({
			subagent_type: "Explore",
			description: "Scout codebase",
			prompt: "Map modules",
		});
		assert.ok(result.content[0]?.text.includes("inline"));
		assert.equal(result.details.agent, "scout");
		assert.ok(result.details.task?.includes("Scout codebase"));
	});
});

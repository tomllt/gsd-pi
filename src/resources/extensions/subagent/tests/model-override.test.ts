import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSubagentProcessArgs } from "../index.js";
import type { AgentConfig } from "../agents.js";

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "test-agent",
		description: "A test agent",
		systemPrompt: "You are a test agent",
		source: "project" as const,
		filePath: "test-agent.md",
		tools: [],
		...overrides,
	};
}

describe("buildSubagentProcessArgs model override", () => {
	it("uses modelOverride when provided", () => {
		const agent = makeAgent({ model: "claude-haiku-4-5-20251001" });
		const args = buildSubagentProcessArgs(agent, "do something", null, "claude-sonnet-4-6");
		const modelIndex = args.indexOf("--model");
		assert.notEqual(modelIndex, -1, "should include --model flag");
		assert.equal(args[modelIndex + 1], "claude-sonnet-4-6");
	});

	it("falls back to agent.model when no override provided", () => {
		const agent = makeAgent({ model: "claude-haiku-4-5-20251001" });
		const args = buildSubagentProcessArgs(agent, "do something", null);
		const modelIndex = args.indexOf("--model");
		assert.notEqual(modelIndex, -1, "should include --model flag");
		assert.equal(args[modelIndex + 1], "claude-haiku-4-5-20251001");
	});

	it("omits --model when neither override nor agent.model is set", () => {
		const agent = makeAgent({ model: undefined });
		const args = buildSubagentProcessArgs(agent, "do something", null);
		assert.equal(args.indexOf("--model"), -1, "should not include --model flag");
	});

	it("override takes precedence over agent.model", () => {
		const agent = makeAgent({ model: "model-a" });
		const args = buildSubagentProcessArgs(agent, "task", null, "model-b");
		const modelIndex = args.indexOf("--model");
		assert.equal(args[modelIndex + 1], "model-b");
	});

	it("uses override even when agent has no model", () => {
		const agent = makeAgent({ model: undefined });
		const args = buildSubagentProcessArgs(agent, "task", null, "model-override");
		const modelIndex = args.indexOf("--model");
		assert.notEqual(modelIndex, -1);
		assert.equal(args[modelIndex + 1], "model-override");
	});
});

describe("buildSubagentProcessArgs thinking override (#508)", () => {
	it("forwards thinkingOverride as --thinking", () => {
		const args = buildSubagentProcessArgs(makeAgent(), "task", null, undefined, "low");
		const idx = args.indexOf("--thinking");
		assert.notEqual(idx, -1, "should include --thinking flag");
		assert.equal(args[idx + 1], "low");
	});

	it("falls back to agent.thinking when no override provided", () => {
		const args = buildSubagentProcessArgs(makeAgent({ thinking: "high" }), "task", null);
		const idx = args.indexOf("--thinking");
		assert.equal(args[idx + 1], "high");
	});

	it("override takes precedence over agent.thinking", () => {
		const args = buildSubagentProcessArgs(makeAgent({ thinking: "high" }), "task", null, undefined, "minimal");
		assert.equal(args[args.indexOf("--thinking") + 1], "minimal");
	});

	it("omits --thinking when neither override nor agent.thinking is set", () => {
		const args = buildSubagentProcessArgs(makeAgent(), "task", null);
		assert.equal(args.indexOf("--thinking"), -1, "should not include --thinking flag");
	});

	it("forwards both model and thinking together", () => {
		const args = buildSubagentProcessArgs(makeAgent(), "task", null, "model-x", "xhigh");
		assert.equal(args[args.indexOf("--model") + 1], "model-x");
		assert.equal(args[args.indexOf("--thinking") + 1], "xhigh");
	});
});

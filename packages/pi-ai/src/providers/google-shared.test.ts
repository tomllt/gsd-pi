import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AssistantMessage, Context, Model } from "../types.js";
import { convertMessages, convertTools, normalizeClaudeToolSchemaForGoogle, sanitizeSchemaForGoogle } from "./google-shared.js";
import { setProviderSwitchObserver, type ProviderSwitchReport } from "./transform-messages.js";

function makeGoogleModel(overrides: Partial<Model<"google-generative-ai">> = {}): Model<"google-generative-ai"> {
	return {
		id: "gemini-2.5-pro",
		name: "Gemini 2.5 Pro",
		api: "google-generative-ai",
		provider: "google",
		baseUrl: "",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 8192,
		...overrides,
	};
}

function makeAssistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-6",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
		...overrides,
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// sanitizeSchemaForGoogle
// ═══════════════════════════════════════════════════════════════════════════

describe("convertMessages", () => {
	it("emits provider switch reports for Google message conversion", () => {
		const reports: ProviderSwitchReport[] = [];
		setProviderSwitchObserver((report) => reports.push(report));
		try {
			const context: Context = {
				messages: [
					makeAssistantMessage({
						content: [
							{ type: "thinking", thinking: "Need to reason through this." },
							{ type: "text", text: "Answer" },
						],
					}),
				],
			};

			convertMessages(makeGoogleModel(), context);

			assert.equal(reports.length, 1);
			assert.equal(reports[0].fromApi, "google-generative-ai");
			assert.equal(reports[0].toApi, "google-generative-ai");
			assert.equal(reports[0].thinkingBlocksDowngraded, 1);
		} finally {
			setProviderSwitchObserver(undefined);
		}
	});
});

describe("sanitizeSchemaForGoogle", () => {
	it("passes through primitives unchanged", () => {
		assert.equal(sanitizeSchemaForGoogle(null), null);
		assert.equal(sanitizeSchemaForGoogle(42), 42);
		assert.equal(sanitizeSchemaForGoogle("hello"), "hello");
		assert.equal(sanitizeSchemaForGoogle(true), true);
	});

	it("passes through a valid schema with no banned fields", () => {
		const schema = {
			type: "object",
			properties: {
				name: { type: "string" },
				age: { type: "number" },
			},
			required: ["name"],
		};
		assert.deepEqual(sanitizeSchemaForGoogle(schema), schema);
	});

	it("removes top-level patternProperties", () => {
		const schema = {
			type: "object",
			patternProperties: { "^S_": { type: "string" } },
			properties: { foo: { type: "string" } },
		};
		const result = sanitizeSchemaForGoogle(schema) as Record<string, unknown>;
		assert.ok(!("patternProperties" in result));
		assert.deepEqual(result.properties, { foo: { type: "string" } });
	});

	it("removes nested patternProperties", () => {
		const schema = {
			type: "object",
			properties: {
				nested: {
					type: "object",
					patternProperties: { ".*": { type: "string" } },
				},
			},
		};
		const result = sanitizeSchemaForGoogle(schema) as any;
		assert.ok(!("patternProperties" in result.properties.nested));
	});

	it("converts top-level const to enum", () => {
		const schema = { const: "fixed-value" };
		const result = sanitizeSchemaForGoogle(schema) as Record<string, unknown>;
		assert.deepEqual(result.enum, ["fixed-value"]);
		assert.equal(result.type, "string");
		assert.ok(!("const" in result));
	});

	it("converts const to enum inside anyOf", () => {
		const schema = {
			anyOf: [{ const: "a" }, { const: "b" }, { type: "string" }],
		};
		const result = sanitizeSchemaForGoogle(schema) as any;
		assert.deepEqual(result.anyOf[0], { enum: ["a"], type: "string" });
		assert.deepEqual(result.anyOf[1], { enum: ["b"], type: "string" });
		assert.deepEqual(result.anyOf[2], { type: "string" });
	});

	it("converts const to enum inside oneOf", () => {
		const schema = {
			oneOf: [{ const: "x" }, { const: "y" }],
		};
		const result = sanitizeSchemaForGoogle(schema) as any;
		assert.deepEqual(result, { enum: ["x", "y"], type: "string" });
	});

	it("recursively sanitizes deeply nested schemas", () => {
		const schema = {
			type: "object",
			properties: {
				level1: {
					type: "object",
					properties: {
						level2: {
							anyOf: [{ const: "deep" }, { type: "null" }],
							patternProperties: { ".*": { type: "string" } },
						},
					},
				},
			},
		};
		const result = sanitizeSchemaForGoogle(schema) as any;
		const level2 = result.properties.level1.properties.level2;
		assert.deepEqual(level2.anyOf[0], { enum: ["deep"], type: "string" });
		assert.ok(!("patternProperties" in level2));
	});

	it("sanitizes items in array schemas", () => {
		const schema = {
			type: "array",
			items: {
				anyOf: [{ const: "foo" }, { type: "string" }],
			},
		};
		const result = sanitizeSchemaForGoogle(schema) as any;
		assert.deepEqual(result.items.anyOf[0], { enum: ["foo"], type: "string" });
	});

	it("sanitizes arrays of schemas", () => {
		const input = [{ const: "a" }, { const: "b" }];
		const result = sanitizeSchemaForGoogle(input) as any[];
		assert.deepEqual(result[0], { enum: ["a"], type: "string" });
		assert.deepEqual(result[1], { enum: ["b"], type: "string" });
	});

	it("converts non-string const values to enum", () => {
		const schema = { const: 42 };
		const result = sanitizeSchemaForGoogle(schema) as Record<string, unknown>;
		assert.deepEqual(result.enum, [42]);
		assert.ok(!("const" in result));
	});

	it("sanitizes additionalProperties", () => {
		const schema = {
			type: "object",
			additionalProperties: {
				patternProperties: { "^x-": { type: "string" } },
			},
		};
		const result = sanitizeSchemaForGoogle(schema) as any;
		assert.ok(!("patternProperties" in result.additionalProperties));
	});
});

describe("normalizeClaudeToolSchemaForGoogle", () => {
	it("merges top-level anyOf object variants into an object-root schema", () => {
		const schema = {
			anyOf: [
				{
					type: "object",
					properties: {
						milestone_id: { type: "string" },
						artifact_type: { type: "string" },
						content: { type: "string" },
					},
					required: ["milestone_id", "artifact_type", "content"],
				},
				{
					type: "object",
					properties: {
						artifact_type: { type: "string" },
						content: { type: "string" },
					},
					required: ["artifact_type", "content"],
				},
			],
		};

		assert.deepEqual(normalizeClaudeToolSchemaForGoogle(schema), {
			type: "object",
			properties: {
				milestone_id: { type: "string" },
				artifact_type: { type: "string" },
				content: { type: "string" },
			},
			required: ["milestone_id", "artifact_type", "content"],
		});
	});

	it("forces object-root parameters for Claude tools on Cloud Code Assist", () => {
		const result = convertTools(
			[
				{
					name: "save_summary",
					description: "Save a summary",
					parameters: {
						anyOf: [
							{
								type: "object",
								properties: { kind: { const: "milestone" }, content: { type: "string" } },
								required: ["kind", "content"],
							},
							{
								type: "object",
								properties: { kind: { const: "project" }, content: { type: "string" } },
								required: ["kind", "content"],
							},
						],
					},
				},
			] as any,
			true,
		);

		assert.deepEqual(result, [
			{
				functionDeclarations: [
					{
						name: "save_summary",
						description: "Save a summary",
						parameters: {
							type: "object",
							properties: {
								kind: { enum: ["milestone", "project"], type: "string" },
								content: { type: "string" },
							},
							required: ["kind", "content"],
						},
					},
				],
			},
		]);
	});

	it("omits empty required and closed-object keywords from Claude parameters", () => {
		const result = convertTools(
			[
				{
					name: "noop",
					description: "Noop",
					parameters: {
						type: "object",
						properties: {},
						required: [],
						additionalProperties: false,
					},
				},
			] as any,
			true,
		);

		assert.deepEqual(result, [
			{
				functionDeclarations: [
					{
						name: "noop",
						description: "Noop",
						parameters: {
							type: "object",
							properties: {},
						},
					},
				],
			},
		]);
	});
});

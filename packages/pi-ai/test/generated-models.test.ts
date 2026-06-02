// Project/App: gsd-pi
// File Purpose: Regression tests for generated model catalog output.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { MODELS } from "../src/models.generated.ts";

describe("models.generated.ts", () => {
	test("does not include floating-point precision artifacts in cost literals", () => {
		// allow-source-grep: generated catalog is data output; this test guards numeric literal formatting only
		const generated = readFileSync(join(import.meta.dirname, "../src/models.generated.ts"), "utf8");
		const noisyCostLiteral = /^\s+(?:input|output|cacheRead|cacheWrite): \d+\.\d{13,},/m;

		expect(generated).not.toMatch(noisyCostLiteral);
	});

	test("includes Anthropic Vertex models from the generated catalog", () => {
		const models = MODELS["anthropic-vertex"];

		expect(models).toBeDefined();
		expect(models["claude-sonnet-4-6"]).toBeDefined();
		expect(models["claude-opus-4-8"]).toBeDefined();
		expect(models["claude-haiku-4-5@20251001"]).toBeDefined();
		expect(Object.keys(models).some((id) => id.includes("@default"))).toBe(false);

		for (const model of Object.values(models)) {
			expect(model.provider).toBe("anthropic-vertex");
			expect(model.api).toBe("anthropic-vertex");
		}
	});

	test("includes MiniMax M3 for direct MiniMax providers", () => {
		const providers = [
			["minimax", "https://api.minimax.io/anthropic"],
			["minimax-cn", "https://api.minimaxi.com/anthropic"],
		] as const;

		for (const [provider, baseUrl] of providers) {
			const model = MODELS[provider]["MiniMax-M3"];

			expect(model).toMatchObject({
				id: "MiniMax-M3",
				name: "MiniMax-M3",
				api: "anthropic-messages",
				provider,
				baseUrl,
				reasoning: true,
				input: ["text", "image"],
				cost: {
					input: 0.3,
					output: 1.2,
					cacheRead: 0.06,
					cacheWrite: 0.375,
				},
				contextWindow: 1000000,
				maxTokens: 131072,
			});
		}
	});
});

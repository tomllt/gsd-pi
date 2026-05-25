// gsd-pi — Tests for Ollama model discovery and enrichment
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { discoverModels } from "../ollama-discovery.js";
import type { OllamaTagsResponse, OllamaShowResponse } from "../types.js";

const EMPTY_DETAILS = { parent_model: "", format: "", family: "", families: null, parameter_size: "", quantization_level: "" };

function modelStub(name: string, parameterSize = "") {
	return { name, model: name, modified_at: "", size: 0, digest: "", details: { ...EMPTY_DETAILS, parameter_size: parameterSize } };
}

function tagsStub(name: string, parameterSize = ""): OllamaTagsResponse {
	return { models: [modelStub(name, parameterSize)] };
}

function showStub(modelInfo: Record<string, unknown>): OllamaShowResponse {
	return { modelfile: "", parameters: "", template: "", details: EMPTY_DETAILS, model_info: modelInfo };
}

function showWithCapabilities(modelInfo: Record<string, unknown>, capabilities: string[]): OllamaShowResponse {
	return { ...showStub(modelInfo), capabilities };
}

describe("discoverModels — context window resolution", () => {
	it("uses known table context window when /api/show returns no context_length", async () => {
		// /api/show is now called unconditionally (for capabilities detection), but
		// when it returns no context_length the table still wins for contextWindow.
		const models = await discoverModels({
			listModels: async () => tagsStub("llama3.2:latest", "3B"),
			showModel: async () => showStub({}),
		});
		assert.equal(models[0].contextWindow, 131072);
	});

	it("uses context_length from /api/show model_info for unknown model", async () => {
		const models = await discoverModels({
			listModels: async () => tagsStub("gemini-3-flash-preview:latest"),
			showModel: async () => showStub({ "gemini.context_length": 1048576 }),
		});
		assert.equal(models[0].contextWindow, 1048576);
	});

	it("falls back to 8192 when /api/show model_info has no context_length key", async () => {
		const models = await discoverModels({
			listModels: async () => tagsStub("unknown-model:latest"),
			showModel: async () => showStub({}),
		});
		assert.equal(models[0].contextWindow, 8192);
	});

	it("falls back to 8192 when /api/show throws", async () => {
		const models = await discoverModels({
			listModels: async () => tagsStub("unknown-model:latest"),
			showModel: async () => { throw new Error("network error"); },
		});
		assert.equal(models[0].contextWindow, 8192);
	});
});

describe("enrichModel — capability detection via /api/show.capabilities", () => {
	it("treats showCapabilities['thinking'] as reasoning=true for an unknown model", async () => {
		const deps = {
			listModels: async () => ({ models: [modelStub("novel-reasoning-model:cloud")] }),
			showModel: async () => showWithCapabilities({ "novel.context_length": 131072 }, ["thinking", "completion"]),
		};
		const [m] = await discoverModels(deps);
		assert.equal(m.reasoning, true, "showCapabilities['thinking'] must set reasoning=true even when KNOWN_MODELS has no entry");
	});

	it("treats empty showCapabilities as reasoning=false even when KNOWN_MODELS has a reasoning entry — false (defined) wins over ?? fallthrough", async () => {
		// llama3.1 in KNOWN_MODELS has no reasoning entry — pick a name where the table WOULD claim reasoning if asked.
		// deepseek-r1 has `reasoning: true` in KNOWN_MODELS. If /api/show says capabilities = [] (no thinking),
		// the ?? chain must NOT fall through to caps.reasoning. Empty array's includes('thinking') is false,
		// which is a *defined* boolean, so ?? does not advance.
		const deps = {
			listModels: async () => ({ models: [modelStub("deepseek-r1:7b", "7B")] }),
			showModel: async () => showWithCapabilities({ "deepseek.context_length": 131072 }, []),
		};
		const [m] = await discoverModels(deps);
		assert.equal(m.reasoning, false,
			"showCapabilities=[] returns false from includes(), which is *defined*; ?? must stop there, NOT fall through to caps.reasoning=true");
	});

	it("treats showCapabilities['vision'] as input including 'image'", async () => {
		const deps = {
			listModels: async () => ({ models: [modelStub("novel-vision-model:cloud")] }),
			showModel: async () => showWithCapabilities({ "vision.context_length": 8192 }, ["vision", "completion"]),
		};
		const [m] = await discoverModels(deps);
		assert.ok(m.input.includes("image"), "showCapabilities['vision'] must include 'image' in model.input");
	});
});

import { afterEach, describe, expect, it } from "vitest";
import {
	registerApiProvider,
	registerProviderApiProvider,
	unregisterApiProviders,
	type ApiProvider,
} from "../src/api-registry.ts";
import { resetApiProviders } from "../src/providers/register-builtins.ts";
import { stream, streamSimple } from "../src/stream.ts";
import type { Api, Context, Model } from "../src/types.ts";

const TEST_API = "test-provider-scoped-api" as Api;

const context: Context = {
	messages: [],
};

function makeModel(provider: string): Model<Api> {
	return {
		id: "test-model",
		name: "Test Model",
		api: TEST_API,
		provider,
		baseUrl: "https://provider.test",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	};
}

function throwingProvider(label: string): ApiProvider<Api> {
	return {
		api: TEST_API,
		stream: () => {
			throw new Error(`${label} stream`);
		},
		streamSimple: () => {
			throw new Error(`${label} simple`);
		},
	};
}

describe("provider-scoped API registry", () => {
	afterEach(() => {
		resetApiProviders();
	});

	it("resolves a provider-scoped handler before the shared API fallback", () => {
		registerApiProvider(throwingProvider("shared"), "test:shared");
		registerProviderApiProvider("scoped-provider", throwingProvider("scoped"), "test:scoped");

		expect(() => stream(makeModel("scoped-provider"), context)).toThrow("scoped stream");
		expect(() => streamSimple(makeModel("scoped-provider"), context)).toThrow("scoped simple");
		expect(() => stream(makeModel("other-provider"), context)).toThrow("shared stream");
		expect(() => streamSimple(makeModel("other-provider"), context)).toThrow("shared simple");
	});

	it("unregisters provider-scoped handlers by source id", () => {
		registerApiProvider(throwingProvider("shared"), "test:shared");
		registerProviderApiProvider("scoped-provider", throwingProvider("scoped"), "test:scoped");

		unregisterApiProviders("test:scoped");

		expect(() => streamSimple(makeModel("scoped-provider"), context)).toThrow("shared simple");
	});
});

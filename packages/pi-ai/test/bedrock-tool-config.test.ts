import { describe, expect, it, vi } from "vitest";
import { Type } from "typebox";

const bedrockMock = vi.hoisted(() => ({
	constructorCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => {
	class BedrockRuntimeServiceException extends Error {}

	class BedrockRuntimeClient {
		constructor(config: Record<string, unknown>) {
			bedrockMock.constructorCalls.push(config);
		}

		send(): Promise<never> {
			return Promise.reject(new Error("mock send"));
		}
	}

	class ConverseStreamCommand {
		readonly input: unknown;

		constructor(input: unknown) {
			this.input = input;
		}
	}

	return {
		BedrockRuntimeClient,
		BedrockRuntimeServiceException,
		ConverseStreamCommand,
		StopReason: {
			END_TURN: "end_turn",
			STOP_SEQUENCE: "stop_sequence",
			MAX_TOKENS: "max_tokens",
			MODEL_CONTEXT_WINDOW_EXCEEDED: "model_context_window_exceeded",
			TOOL_USE: "tool_use",
		},
		CachePointType: { DEFAULT: "default" },
		CacheTTL: { ONE_HOUR: "ONE_HOUR" },
		ConversationRole: { ASSISTANT: "assistant", USER: "user" },
		ImageFormat: { JPEG: "jpeg", PNG: "png", GIF: "gif", WEBP: "webp" },
		ToolResultStatus: { ERROR: "error", SUCCESS: "success" },
	};
});

import { getModel } from "../src/models.ts";
import { streamBedrock } from "../src/providers/amazon-bedrock.ts";
import type { Context, Tool } from "../src/types.ts";

const baseModel = getModel("amazon-bedrock", "us.anthropic.claude-sonnet-4-5-20250929-v1:0");

const echoSchema = Type.Object({
	message: Type.String({ description: "Message to echo" }),
});

const echoTool: Tool<typeof echoSchema> = {
	name: "echo",
	description: "Echo a message",
	parameters: echoSchema,
};

async function capturePayload(context: Context): Promise<unknown> {
	let capturedPayload: unknown;
	const s = streamBedrock(baseModel, context, {
		cacheRetention: "none",
		signal: AbortSignal.abort(),
		onPayload: (payload) => {
			capturedPayload = payload;
			return payload;
		},
	});
	for await (const event of s) {
		if (event.type === "error") break;
	}
	return capturedPayload;
}

describe("bedrock tool config", () => {
	it("passes TypeBox tool parameters through as JSON schema", async () => {
		const payload = await capturePayload({
			messages: [{ role: "user", content: "echo hello", timestamp: Date.now() }],
			tools: [echoTool],
		});

		expect(payload).toBeDefined();
		const toolConfig = (payload as { toolConfig?: { tools?: Array<{ toolSpec?: { inputSchema?: { json?: unknown } } }> } })
			.toolConfig;
		expect(toolConfig?.tools).toHaveLength(1);
		expect(toolConfig?.tools?.[0]?.toolSpec?.inputSchema?.json).toEqual(echoSchema);
	});
});

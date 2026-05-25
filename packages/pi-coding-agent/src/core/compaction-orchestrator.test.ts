import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, mock, type Mock } from "node:test";

import type { Agent } from "@gsd/pi-agent-core";
import type { Api, AssistantMessage, Model } from "@gsd/pi-ai";

import { CompactionOrchestrator, type CompactionOrchestratorDeps } from "./compaction-orchestrator.js";
import { SessionManager } from "./session-manager.js";

function createMockModel(): Model<Api> {
	return {
		id: "claude-opus-4-6",
		name: "Claude Opus 4.6",
		api: "anthropic-messages" as Api,
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 16_384,
	} as Model<Api>;
}

function createAssistantMessage(
	stopReason: AssistantMessage["stopReason"],
	contentText: string,
): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: contentText }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-opus-4-6",
		usage: {
			input: 100,
			output: 100,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 200,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
		errorMessage: stopReason === "error" ? contentText : undefined,
	} as AssistantMessage;
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function createHarness(overrides?: {
	cancelResult?: boolean;
	willRetry?: boolean;
	hasQueuedMessages?: boolean;
	keepRecentTokens?: number;
	thresholdPercent?: number;
}) {
	const dir = mkdtempSync(join(tmpdir(), "compaction-orchestrator-test-"));
	const sessionManager = SessionManager.create(dir, dir);
	sessionManager.appendMessage({ role: "user", content: "First user message" } as any);
	sessionManager.appendMessage(createAssistantMessage("stop", "First assistant message"));
	sessionManager.appendMessage({ role: "user", content: "Second user message" } as any);

	const emittedEvents: Array<Record<string, unknown>> = [];
	const continueFn = mock.fn(async () => {});
	const replaceMessages = mock.fn((nextMessages: unknown[]) => {
		(agent.state.messages as unknown[]) = nextMessages;
	});
	const agent = {
		state: {
			messages: [
				{ role: "user", content: "queued follow-up" },
				createAssistantMessage("error", "context overflow"),
			],
		},
		continue: continueFn,
		replaceMessages,
		hasQueuedMessages: () => overrides?.hasQueuedMessages ?? false,
	} as unknown as Agent;

	const extensionRunner: {
		hasHandlers: ReturnType<typeof mock.fn>;
		emit: ReturnType<typeof mock.fn>;
	} = {
		hasHandlers: mock.fn(() => true),
		emit: mock.fn(async () => ({ cancel: overrides?.cancelResult ?? true })),
	};

	const deps: CompactionOrchestratorDeps = {
		agent,
		sessionManager,
		settingsManager: {
			getCompactionSettings: () => ({
				enabled: true,
				reserveTokens: 16_384,
				keepRecentTokens: overrides?.keepRecentTokens ?? 1,
				thresholdPercent: overrides?.thresholdPercent,
			}),
		} as any,
		modelRegistry: {
			isProviderRequestReady: () => true,
			getApiKey: async () => undefined,
		} as any,
		getModel: () => createMockModel(),
		getSessionId: () => "test-session",
		getExtensionRunner: () => extensionRunner as any,
		emit: (event) => emittedEvents.push(event as unknown as Record<string, unknown>),
		disconnectFromAgent: () => {},
		reconnectToAgent: () => {},
		abort: async () => {},
	};

	return {
		dir,
		agent,
		sessionManager,
		continueFn,
		replaceMessages,
		emittedEvents,
		extensionRunner,
		orchestrator: new CompactionOrchestrator(deps),
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

describe("CompactionOrchestrator", () => {
	it("overflow cancel keeps retry intent and resumes the agent (#3971)", async (t) => {
		const harness = createHarness({ willRetry: true });
		t.after(harness.cleanup);

		await (harness.orchestrator as any)._runAutoCompaction("overflow", true);
		await wait(150);

		const endEvent = harness.emittedEvents.find((event) => event.type === "auto_compaction_end");
		assert.ok(endEvent, "should emit auto_compaction_end");
		assert.equal(endEvent?.aborted, true, "cancelled compaction should be marked aborted");
		assert.equal(endEvent?.willRetry, true, "overflow cancel should preserve retry intent");
		assert.equal(harness.continueFn.mock.callCount(), 1, "overflow cancel should resume the agent");
		assert.equal(harness.replaceMessages.mock.callCount(), 1, "retry follow-up should trim the error message when present");
	});

	it("threshold cancel stays non-retrying when no queued messages exist", async (t) => {
		const harness = createHarness({ willRetry: false, hasQueuedMessages: false });
		t.after(harness.cleanup);

		await (harness.orchestrator as any)._runAutoCompaction("threshold", false);
		await wait(150);

		const endEvent = harness.emittedEvents.find((event) => event.type === "auto_compaction_end");
		assert.ok(endEvent, "should emit auto_compaction_end");
		assert.equal(endEvent?.aborted, true, "cancelled compaction should be marked aborted");
		assert.equal(endEvent?.willRetry, false, "threshold cancel should stay non-retrying");
		assert.equal(harness.continueFn.mock.callCount(), 0, "threshold cancel should not resume the agent without queued work");
		assert.equal(harness.replaceMessages.mock.callCount(), 0, "non-retry cancel should not trim messages");
	});

	it("(#109) empty prepared input aborts before session_before_compact hooks", async (t) => {
		const harness = createHarness({ keepRecentTokens: 1_000_000 });
		t.after(harness.cleanup);
		const before = harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction").length;

		await (harness.orchestrator as any)._runAutoCompaction("threshold", false);

		assert.equal(harness.extensionRunner.emit.mock.callCount(), 0, "invalid compaction must not reach hooks");
		assert.equal(
			harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction").length,
			before,
			"invalid compaction must not append a compaction entry",
		);
		const endEvent = harness.emittedEvents.find((event) => event.type === "auto_compaction_end");
		assert.match(String(endEvent?.errorMessage), /history preserved as-is/);
	});

	it("(#109) degenerate extension summaries abort without appending compaction", async (t) => {
		const harness = createHarness();
		t.after(harness.cleanup);
		const firstKeptEntryId = harness.sessionManager.getBranch()[0]?.id;
		assert.ok(firstKeptEntryId, "test session should have an entry id");
		harness.extensionRunner.emit.mock.mockImplementation(async () => ({
			compaction: {
				summary:
					"The conversation block you've handed me is empty: there's nothing between the <conversation> tags to summarize.",
				firstKeptEntryId,
				tokensBefore: 123,
			},
		}));
		const before = harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction").length;

		await (harness.orchestrator as any)._runAutoCompaction("threshold", false);

		assert.equal(
			harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction").length,
			before,
			"degenerate extension compaction must not be committed",
		);
		const endEvent = harness.emittedEvents.find((event) => event.type === "auto_compaction_end");
		assert.match(String(endEvent?.errorMessage), /history preserved as-is/);
	});

	it("(#109) cumulative totalTokens alone does not trigger threshold compaction", async (t) => {
		const harness = createHarness({ thresholdPercent: 0.6 });
		t.after(harness.cleanup);
		const assistant = createAssistantMessage("stop", "small live prompt");
		assistant.usage = {
			input: 10,
			output: 5,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 4_623_740,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};

		await harness.orchestrator.checkCompaction(assistant);

		assert.equal(
			harness.emittedEvents.some((event) => event.type === "auto_compaction_start"),
			false,
			"huge cumulative totalTokens must not drive threshold compaction",
		);
		assert.equal(harness.extensionRunner.emit.mock.callCount(), 0);
	});
});

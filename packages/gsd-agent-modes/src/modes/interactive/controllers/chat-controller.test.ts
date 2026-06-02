import assert from "node:assert/strict";
import test from "node:test";
import { Container } from "@gsd/pi-tui";
import stripAnsi from "strip-ansi";

import {
	findLatestPinnableText,
	handleAgentEvent,
	isProvisionalPreToolProse,
	isRedundantDiscussRestatement,
	priorAssistantTextFromSession,
	textInvitesUserReply,
} from "./chat-controller.js";
import { initTheme } from "@gsd/pi-coding-agent/theme/theme.js";

function createStreamingHost(chatContainer: Container): any {
	return {
		isInitialized: true,
		footer: { invalidate() {} },
		settingsManager: {
			getTimestampFormat() {
				return "date-time-iso";
			},
			getShowImages() {
				return false;
			},
		},
		getMarkdownThemeWithSettings() {
			return undefined;
		},
		getRegisteredToolDefinition() {
			return undefined;
		},
		formatWebSearchResult() {
			return "";
		},
		session: { messages: [], retryAttempt: 0 },
		chatContainer,
		pendingTools: new Map(),
		pendingMessagesContainer: { clear() {} },
		pinnedMessageContainer: new Container(),
		statusContainer: new Container(),
		hideThinkingBlock: true,
		toolOutputExpanded: false,
		loadingAnimation: undefined,
		pendingWorkingMessage: undefined,
		defaultWorkingMessage: "Working...",
		ui: {
			terminal: { rows: 60, columns: 100 },
			requestRender() {},
		},
	};
}

test("textInvitesUserReply: detects question handoff", () => {
	assert.equal(textInvitesUserReply("What do you want to build for M006?"), true);
	assert.equal(textInvitesUserReply("Let me write the context file now."), false);
});

test("isRedundantDiscussRestatement: drops second milestone ask sub-turn", () => {
	const prior = [
		"You have a neo-brutalist todo app with five milestones done.",
		"What do you want to build for M006?",
		"What's on your mind?",
	].join("\n");
	const next = [
		"I see M006 was created with a placeholder name.",
		"Before I can write the context file, what do you want M006 to be?",
	].join("\n");
	assert.equal(isRedundantDiscussRestatement(prior, next), true);
});

test("priorAssistantTextFromSession: skips tool results and newest assistant", () => {
	const prior = [
		"What do you want M006 to do?",
		"What's driving this?",
	].join("\n");
	const messages = [
		{ role: "user", content: "start" },
		{ role: "assistant", content: [{ type: "text", text: prior }] },
		{ role: "toolResult", content: [{ type: "text", text: "ok" }] },
		{ role: "assistant", content: [{ type: "text", text: "What do you want M006 to be?" }] },
	];
	assert.equal(priorAssistantTextFromSession(messages, { skipLastAssistant: true }), prior);
});

test("isRedundantDiscussRestatement: keeps genuinely new follow-up questions", () => {
	const prior = "Should we add keyboard shortcuts or recurring tasks for M006?";
	const next = "Also, do you want this milestone to include a backend or stay local-only?";
	assert.equal(isRedundantDiscussRestatement(prior, next), false);
});

test("isRedundantDiscussRestatement: keeps short new follow-up questions", () => {
	const prior = "What do you want to build for M006?";
	const next = "I found 3 modules. Should I add docs?";
	assert.equal(isRedundantDiscussRestatement(prior, next), false);
});

test("isProvisionalPreToolProse: only treats transient tool scaffolding as disposable", () => {
	assert.equal(isProvisionalPreToolProse("I'll inspect the current state and then patch it."), true);
	assert.equal(isProvisionalPreToolProse("Running the focused tests now."), true);
	assert.equal(
		isProvisionalPreToolProse(
			"I'm still waiting on your actual answer, and I want to be transparent about what I'm seeing.",
		),
		false,
	);
	assert.equal(isProvisionalPreToolProse("What do you want to build next?"), false);
});

test("findLatestPinnableText: empty content returns empty string", () => {
	assert.equal(findLatestPinnableText([]), "");
});

test("findLatestPinnableText: no tool calls returns empty string", () => {
	const blocks = [
		{ type: "text", text: "hello" },
		{ type: "text", text: "world" },
	];
	assert.equal(findLatestPinnableText(blocks), "");
});

test("findLatestPinnableText: returns text preceding a tool call", () => {
	const blocks = [
		{ type: "text", text: "doing the thing" },
		{ type: "toolCall", id: "1", name: "Read" },
	];
	assert.equal(findLatestPinnableText(blocks), "doing the thing");
});

test("findLatestPinnableText: ignores trailing streaming text after the last tool call (regression: pinned mirror duplicated chat-container tokens)", () => {
	const blocks = [
		{ type: "text", text: "first prose" },
		{ type: "toolCall", id: "1", name: "Read" },
		{ type: "text", text: "second prose still streaming" },
	];
	assert.equal(findLatestPinnableText(blocks), "first prose");
});

test("findLatestPinnableText: with multiple tools, picks text before the most recent tool call", () => {
	const blocks = [
		{ type: "text", text: "first" },
		{ type: "toolCall", id: "1", name: "Read" },
		{ type: "text", text: "second" },
		{ type: "toolCall", id: "2", name: "Grep" },
		{ type: "text", text: "third streaming" },
	];
	assert.equal(findLatestPinnableText(blocks), "second");
});

test("findLatestPinnableText: treats serverToolUse the same as toolCall", () => {
	const blocks = [
		{ type: "text", text: "before web search" },
		{ type: "serverToolUse", id: "ws1", name: "web_search" },
		{ type: "text", text: "answer streaming" },
	];
	assert.equal(findLatestPinnableText(blocks), "before web search");
});

test("findLatestPinnableText: skips empty/whitespace-only text blocks", () => {
	const blocks = [
		{ type: "text", text: "real prose" },
		{ type: "text", text: "   " },
		{ type: "text", text: "" },
		{ type: "toolCall", id: "1", name: "Read" },
	];
	assert.equal(findLatestPinnableText(blocks), "real prose");
});

test("findLatestPinnableText: thinking blocks are not pinnable", () => {
	const blocks = [
		{ type: "thinking", thinking: "internal" },
		{ type: "toolCall", id: "1", name: "Read" },
	];
	assert.equal(findLatestPinnableText(blocks), "");
});

test("handleAgentEvent: agent_start clears stale adaptive blocking error", async () => {
	initTheme("dark", false);
	let cleared = false;
	let requestedRender = false;
	const host = {
		isInitialized: true,
		clearBlockingError: () => {
			cleared = true;
		},
		retryEscapeHandler: undefined,
		retryLoader: undefined,
		loadingAnimation: undefined,
		statusContainer: {
			clear() {},
			addChild() {},
		},
		ui: {
			requestRender() {
				requestedRender = true;
			},
		},
		defaultEditor: {},
		footer: {
			invalidate() {},
		},
		settingsManager: {
			getTimestampFormat() {
				return "date-time-iso";
			},
		},
		defaultWorkingMessage: "Working...",
		pendingWorkingMessage: undefined,
	} as any;

	await handleAgentEvent(host, { type: "agent_start" } as any);
	host.loadingAnimation?.stop();

	assert.equal(cleared, true);
	assert.equal(requestedRender, true);
});

test("handleAgentEvent: agent_start suppresses loader when extension requested no working message", async () => {
	initTheme("dark", false);
	let addChildCalled = false;
	let requestedRender = false;
	const host = {
		isInitialized: true,
		clearBlockingError() {},
		retryEscapeHandler: undefined,
		retryLoader: undefined,
		loadingAnimation: undefined,
		statusContainer: {
			clear() {},
			addChild() {
				addChildCalled = true;
			},
		},
		ui: {
			requestRender() {
				requestedRender = true;
			},
		},
		defaultEditor: {},
		footer: {
			invalidate() {},
		},
		settingsManager: {
			getTimestampFormat() {
				return "date-time-iso";
			},
		},
		defaultWorkingMessage: "Working...",
		pendingWorkingMessage: null,
	} as any;

	await handleAgentEvent(host, { type: "agent_start" } as any);

	assert.equal(host.loadingAnimation, undefined);
	assert.equal(host.pendingWorkingMessage, null);
	assert.equal(addChildCalled, false);
	assert.equal(requestedRender, true);
});

test("handleAgentEvent: standalone completed tool events roll up incrementally", async () => {
	initTheme("dark", false);
	const chatContainer = new Container();
	let renderCount = 0;
	const host = {
		isInitialized: true,
		footer: { invalidate() {} },
		settingsManager: {
			getTimestampFormat() {
				return "date-time-iso";
			},
			getShowImages() {
				return false;
			},
		},
		getRegisteredToolDefinition() {
			return undefined;
		},
		chatContainer,
		pendingTools: new Map(),
		ui: {
			requestRender() {
				renderCount++;
			},
		},
	} as any;

	for (const [toolCallId, toolName] of [
		["read-1", "read"],
		["read-2", "read"],
		["edit-1", "edit"],
	] as const) {
		const target =
			toolName === "edit"
				? {
						kind: "file",
						action: "edit",
						inputPath: `src/${toolCallId}.txt`,
						resolvedPath: `/tmp/project/src/${toolCallId}.txt`,
						line: 10,
					}
				: {
						kind: "file",
						action: "read",
						inputPath: `src/${toolCallId}.txt`,
						resolvedPath: `/tmp/project/src/${toolCallId}.txt`,
					};
		await handleAgentEvent(host, {
			type: "tool_execution_start",
			toolCallId,
			toolName,
			args: { path: `src/${toolCallId}.txt` },
		} as any);
		await handleAgentEvent(host, {
			type: "tool_execution_end",
			toolCallId,
			toolName,
			result: { content: [], details: { target }, isError: false },
			isError: false,
		} as any);
	}

	const rendered = stripAnsi(chatContainer.render(100).join("\n"));
	assert.match(rendered, /Context reads · 2 files\s+success · \d+(ms|s)/);
	assert.match(rendered, /src\/read-1\.txt/);
	assert.match(rendered, /src\/read-2\.txt/);
	assert.match(rendered, /File changes · 1 file, 1 edit\s+success · \d+(ms|s)/);
	assert.match(rendered, /src\/edit-1\.txt:10/);
	assert.doesNotMatch(rendered, /^\s*│?\s*read\s+success ·/m);
	assert.doesNotMatch(rendered, /^\s*│?\s*edit\s+success ·/m);
	assert.ok(renderCount > 0);
});

test("handleAgentEvent: Claude Code MCP post-tool text does not erase user-facing pre-tool prose", async () => {
	initTheme("dark", false);
	const chatContainer = new Container();
	const preToolText =
		"I'm still waiting on your actual answer, and I want to be transparent about what I'm seeing.";
	const postToolText = "I'll stay parked here until the missing project description arrives.";
	function makeMessage(content: any[]): any {
		return {
			id: "a-mcp",
			role: "assistant",
			provider: "claude-code",
			model: "claude-opus-4-8",
			timestamp: 1,
			stopReason: "stop",
			content,
		};
	}
	const host = createStreamingHost(chatContainer);
	const toolBlock = { type: "serverToolUse", id: "mcp-1", name: "mcp__gsd__status", input: {} };
	const first = makeMessage([{ type: "text", text: preToolText }, toolBlock]);

	await handleAgentEvent(host, { type: "message_start", message: makeMessage([]) } as any);
	await handleAgentEvent(host, {
		type: "message_update",
		message: first,
		assistantMessageEvent: { type: "server_tool_use", contentIndex: 1, partial: first },
	} as any);

	assert.match(stripAnsi(chatContainer.render(100).join("\n")), /still waiting on your actual answer/);

	const final = makeMessage([{ type: "text", text: preToolText }, toolBlock, { type: "text", text: postToolText }]);
	await handleAgentEvent(host, {
		type: "message_update",
		message: final,
		assistantMessageEvent: { type: "text_delta", contentIndex: 2, delta: postToolText, partial: final },
	} as any);
	await handleAgentEvent(host, { type: "message_end", message: final } as any);

	const rendered = stripAnsi(chatContainer.render(100).join("\n"));
	assert.match(rendered, /still waiting on your actual answer/);
	assert.match(rendered, /stay parked here/);
});

test("handleAgentEvent: message_end keeps the current handoff reply visible", async () => {
	initTheme("dark", false);
	const chatContainer = new Container();
	const text = "What do you want to build next?";
	const message = {
		id: "a-question",
		role: "assistant",
		provider: "claude-code",
		model: "claude-opus-4-8",
		timestamp: 1,
		stopReason: "stop",
		content: [{ type: "text", text }],
	};
	const host = createStreamingHost(chatContainer);

	await handleAgentEvent(host, { type: "message_start", message: { ...message, content: [] } } as any);
	await handleAgentEvent(host, {
		type: "message_update",
		message,
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text, partial: message },
	} as any);

	assert.match(stripAnsi(chatContainer.render(100).join("\n")), /What do you want to build next/);

	await handleAgentEvent(host, { type: "message_end", message } as any);

	assert.match(stripAnsi(chatContainer.render(100).join("\n")), /What do you want to build next/);
});

test("handleAgentEvent: agent_end finalizes orphaned pending tool cards", async () => {
	initTheme("dark", false);
	const chatContainer = new Container();
	const host = {
		isInitialized: true,
		footer: { invalidate() {} },
		settingsManager: {
			getTimestampFormat() {
				return "date-time-iso";
			},
			getShowImages() {
				return false;
			},
		},
		getRegisteredToolDefinition() {
			return undefined;
		},
		chatContainer,
		pendingTools: new Map(),
		loadingAnimation: undefined,
		statusContainer: { clear() {} },
		streamingComponent: undefined,
		streamingMessage: undefined,
		pinnedMessageContainer: { clear() {} },
		checkShutdownRequested: async () => {},
		ui: {
			requestRender() {},
		},
	} as any;

	await handleAgentEvent(host, {
		type: "tool_execution_start",
		toolCallId: "capture-1",
		toolName: "capture_thought",
		args: { thought: "write the milestone roadmap" },
	} as any);

	assert.match(
		stripAnsi(chatContainer.render(100).join("\n")),
		/running/,
		"precondition: orphaned tool card starts in running state",
	);

	await handleAgentEvent(host, {
		type: "agent_end",
		messages: [],
		willRetry: false,
	} as any);

	const rendered = stripAnsi(chatContainer.render(100).join("\n"));
	assert.doesNotMatch(rendered, /running/, "agent_end must not leave stale running tool cards");
	assert.match(rendered, /success/, "orphaned tool card should settle as no-result success");
});

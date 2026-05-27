// Project/App: gsd-pi
// File Purpose: Connected chat turn reconciliation tests.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import stripAnsi from "strip-ansi";
import type { AssistantMessage } from "@gsd/pi-ai";
import { Container, Spacer, Text } from "@gsd/pi-tui";

import { initTheme } from "@gsd/pi-coding-agent/theme/theme.js";
import { AssistantMessageComponent } from "../assistant-message.js";
import { reconcileChatTurnConnections } from "../chat-turn-connect.js";
import { ToolExecutionComponent, ToolPhaseSummaryComponent } from "../tool-execution.js";
import { UserMessageComponent } from "../user-message.js";

initTheme("dark", false);

function assistant(text: string): AssistantMessageComponent {
	const message = {
		id: "a",
		role: "assistant",
		provider: "test",
		model: "gpt-test",
		timestamp: 1,
		content: [{ type: "text", text }],
	} as unknown as AssistantMessage;
	return new AssistantMessageComponent(message, true);
}

function renderVersion(component: UserMessageComponent | AssistantMessageComponent): number {
	return (component as unknown as { renderVersion: number }).renderVersion;
}

describe("reconcileChatTurnConnections", () => {
	test("connects consecutive user and assistant turns with no blank spacer lines", () => {
		const chat = new Container();
		chat.addChild(new UserMessageComponent("hi"));
		chat.addChild(assistant("Hello!"));
		chat.addChild(new UserMessageComponent("follow up"));
		chat.addChild(assistant("Sure."));
		reconcileChatTurnConnections(chat.children);

		const lines = chat.render(80).map((line) => stripAnsi(line));
		assert.equal(
			lines.filter((line) => line.trim() === "").length,
			0,
			`connected transcript should not insert blank lines:\n${lines.join("\n")}`,
		);
		assert.match(lines.join("\n"), /╰──────╮[\s\S]*╭─ GSD/);
		assert.match(lines.join("\n"), /╰──────╮[\s\S]*╭─ YOU/);
	});

	test("does not connect turns separated by non-chat components", () => {
		const chat = new Container();
		const firstAssistant = assistant("Hello!");
		chat.addChild(new UserMessageComponent("hi"));
		chat.addChild(firstAssistant);
		chat.addChild(new Text("status", 1, 0));
		chat.addChild(new UserMessageComponent("later"));
		reconcileChatTurnConnections(chat.children);

		const assistantLines = firstAssistant.render(80).map((line) => stripAnsi(line)).join("\n");
		assert.match(assistantLines, /╰─{4,}/, "assistant should close before unrelated chat content");
	});

	test("still connects turns when only spacer components sit between them", () => {
		const chat = new Container();
		chat.addChild(new UserMessageComponent("hi"));
		chat.addChild(new Spacer(1));
		chat.addChild(assistant("Hello!"));
		reconcileChatTurnConnections(chat.children);

		const lines = chat.render(80).map((line) => stripAnsi(line)).join("\n");
		assert.doesNotMatch(lines.split("\n")[0] ?? "", /^\s*$/, "user turn should start flush at the top");
		assert.match(lines, /╰──────╮[\s\S]*╭─ GSD/);
	});

	test("still connects turns when tool components sit between them", () => {
		const chat = new Container();
		const response = assistant("Done.");
		chat.addChild(new UserMessageComponent("Inspect this"));
		chat.addChild(
			new ToolExecutionComponent("read", { path: "README.md" }, {}, undefined, {
				requestRender() {},
			} as any),
		);
		chat.addChild(
			new ToolPhaseSummaryComponent([
				{ label: "Context reads", count: 1, durationMs: 5, targets: ["README.md"] },
			]),
		);
		chat.addChild(response);
		reconcileChatTurnConnections(chat.children);

		const assistantLines = response.render(80).map((line) => stripAnsi(line));
		assert.doesNotMatch(
			assistantLines[0] ?? "",
			/^\s*$/,
			"assistant should remain connected when tools sit between turns",
		);
	});

	test("does not invalidate render caches when connections are unchanged", () => {
		const chat = new Container();
		const user = new UserMessageComponent("hi");
		const response = assistant("Hello!");
		chat.addChild(user);
		chat.addChild(response);
		reconcileChatTurnConnections(chat.children);

		const userRenderVersion = renderVersion(user);
		const responseRenderVersion = renderVersion(response);
		reconcileChatTurnConnections(chat.children);

		assert.equal(renderVersion(user), userRenderVersion);
		assert.equal(renderVersion(response), responseRenderVersion);
	});
});

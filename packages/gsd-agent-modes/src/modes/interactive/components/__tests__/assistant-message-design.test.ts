// Project/App: gsd-pi
// File Purpose: Visual contract tests for the assistant message open surface.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import stripAnsi from "strip-ansi";
import type { AssistantMessage } from "@gsd/pi-ai";

import { initTheme } from "@gsd/pi-coding-agent/theme/theme.js";
import { AssistantMessageComponent } from "../assistant-message.js";
import { formatTimestamp } from "../timestamp.js";
import { renderAssistantRail, renderUserRail } from "../transcript-design.js";

initTheme("dark", false);

describe("AssistantMessageComponent open surface", () => {
	test("renders assistant content as a copy-clean open surface", () => {
		const message = {
			id: "m1",
			role: "assistant",
			provider: "test",
			model: "gpt-test",
			timestamp: 1,
			content: [{ type: "text", text: "I will update the renderer and run verification." }],
		} as unknown as AssistantMessage;

		const component = new AssistantMessageComponent(message, true);
		const raw = component.render(80);
		const plain = raw.map((line) => stripAnsi(line));
		const joined = plain.join("\n");

		assert.match(joined, /GSD/);
		assert.match(joined, /gpt-test/);
		assert.match(joined, /update the renderer/);
		assert.doesNotMatch(joined, /╰──────╮/);
		assert.match(joined, /╭─ GSD/);
		assert.match(joined, /╰/);
		assert.doesNotMatch(joined, /[│┃]/, "assistant content lines must not use side rail glyphs");
		assert.ok(
			plain.some((line) => line.includes("GSD") && line.includes("─")),
			`expected a titled top rule:\n${joined}`,
		);
		const topRuleIndex = plain.findIndex((line) => line.includes("GSD") && line.includes("─"));
		const contentIndex = plain.findIndex((line) => line.includes("update the renderer"));
		assert.ok(contentIndex > topRuleIndex, `expected content after the top rule:\n${joined}`);
		assert.ok(plain[topRuleIndex]?.startsWith("╭─ GSD"), `assistant turn should be left-pegged:\n${joined}`);
		assert.ok(plain[contentIndex].startsWith("   "), `assistant content should keep inner padding:\n${joined}`);
		assert.doesNotMatch(
			plain[contentIndex],
			/^ {10,}/,
			`assistant content should not preserve the old outer rail indent:\n${joined}`,
		);
		assert.doesNotMatch(raw[contentIndex] ?? "", /\x1b\[48[;:]/, "assistant content rows should not paint a background");
		assert.equal(plain[contentIndex].length, 80, `assistant content row should fill the card interior:\n${joined}`);
		assert.doesNotMatch(plain[contentIndex], /[│┃╭╮╰╯]/, `content line must stay copy-clean:\n${joined}`);
	});

	test("bridges from an indented user turn when connectedToUser is set", () => {
		const message = {
			id: "m1",
			role: "assistant",
			provider: "test",
			model: "gpt-test",
			timestamp: 1,
			content: [{ type: "text", text: "Connected reply." }],
		} as unknown as AssistantMessage;

		const component = new AssistantMessageComponent(message, true, undefined, "date-time-iso", undefined, true);
		const plain = component.render(80).map((line) => stripAnsi(line));
		const joined = plain.join("\n");

		assert.match(joined, /╰──────╮/);
		assert.match(joined, /╭─ GSD/);
		const bridge = plain.find((line) => line.includes("╰──────╮"));
		assert.ok(bridge?.startsWith("    ╰──────╮"), `bridge should align with the user rail indent:\n${joined}`);
	});

	test("connects an indented user card to a left-pegged assistant card", () => {
		const user = renderUserRail(["hi"], 80, { label: "You", continuesToAssistant: true }).map((line) =>
			stripAnsi(line),
		);
		const assistant = renderAssistantRail(["Hey there"], 80, { label: "GSD", connected: true }).map((line) =>
			stripAnsi(line),
		);
		const joined = [...user, ...assistant].join("\n");
		const bridge = assistant.find((line) => line.includes("╰──────╮"));

		assert.doesNotMatch(user.join("\n"), /╰─{4,}/, `user card should stay open for the bridge:\n${joined}`);
		assert.ok(bridge?.startsWith("    ╰──────╮"), `bridge should drop from the user rail:\n${joined}`);
		assert.equal(assistant[0], bridge, `connected assistant should start on the bridge with no spacer:\n${joined}`);
		assert.ok(assistant.some((line) => line.startsWith("╭─ GSD")), `assistant should stay left-pegged:\n${joined}`);
	});

	test("connects a left-pegged assistant card down into the next user turn", () => {
		const assistant = renderAssistantRail(["Hey there"], 80, { label: "GSD", continuesToUser: true }).map((line) =>
			stripAnsi(line),
		);
		const user = renderUserRail(["follow up"], 80, { label: "You" }).map((line) => stripAnsi(line));
		const joined = [...assistant, ...user].join("\n");
		const bridge = assistant[assistant.length - 1];

		assert.doesNotMatch(assistant.slice(0, -1).join("\n"), /╰─{4,}/, `assistant card should stay open:\n${joined}`);
		assert.match(bridge ?? "", /╰──────╮/, `assistant should end on a bridge:\n${joined}`);
		assert.ok(bridge?.startsWith("╰──────╮"), `bridge should start at the assistant rail:\n${joined}`);
		assert.ok(user[0]?.startsWith("    ╭─ YOU"), `next user turn should attach flush:\n${joined}`);
	});

	test("renders a full connected chat turn cycle without spacer lines", () => {
		const user1 = renderUserRail(["hi"], 80, { label: "You", continuesToAssistant: true }).map((line) =>
			stripAnsi(line),
		);
		const assistant1 = renderAssistantRail(["Hello"], 80, { label: "GSD", connected: true, continuesToUser: true }).map(
			(line) => stripAnsi(line),
		);
		const user2 = renderUserRail(["follow up"], 80, { label: "You", continuesToAssistant: true }).map((line) =>
			stripAnsi(line),
		);
		const assistant2 = renderAssistantRail(["Sure"], 80, { label: "GSD", connected: true }).map((line) => stripAnsi(line));
		const joined = [...user1, ...assistant1, ...user2, ...assistant2];

		assert.equal(joined.filter((line) => line.trim() === "").length, 0, `connected turns should not insert blank lines:\n${joined.join("\n")}`);
	});

	test("can render a connector only when explicitly requested", () => {
		const standalone = renderAssistantRail(["Standalone"], 80, { label: "GSD" })
			.map((line) => stripAnsi(line))
			.join("\n");
		const connected = renderAssistantRail(["Connected"], 80, { label: "GSD", connected: true })
			.map((line) => stripAnsi(line))
			.join("\n");

		assert.doesNotMatch(standalone, /╰──────╮/);
		assert.match(connected, /╰──────╮/);
	});

	test("renders metadata for a zero timestamp", () => {
		const message = {
			id: "m1",
			role: "assistant",
			provider: "test",
			model: "gpt-test",
			timestamp: 0,
			content: [{ type: "text", text: "Finished." }],
		} as unknown as AssistantMessage;

		const component = new AssistantMessageComponent(message, true);
		const joined = component.render(80).map((line) => stripAnsi(line)).join("\n");

		assert.match(joined, new RegExp(formatTimestamp(0)));
	});

	test("reuses rendered output until assistant message state changes", () => {
		const message = {
			id: "m1",
			role: "assistant",
			provider: "test",
			model: "gpt-test",
			timestamp: 1,
			content: [{ type: "text", text: "Cached assistant content." }],
		} as unknown as AssistantMessage;
		const component = new AssistantMessageComponent(message, true);

		const first = component.render(80);
		assert.equal(component.render(80), first);

		component.updateContent({
			...message,
			content: [{ type: "text", text: "Updated assistant content." }],
		} as unknown as AssistantMessage);
		const updated = component.render(80);

		assert.notEqual(updated, first);
		assert.match(updated.map((line) => stripAnsi(line)).join("\n"), /Updated assistant content/);
	});

	test("rebuilds the current assistant message when thinking visibility changes", () => {
		const message = {
			id: "m1",
			role: "assistant",
			provider: "test",
			model: "gpt-test",
			content: [{ type: "thinking", thinking: "Private reasoning trace." }],
		} as unknown as AssistantMessage;
		const component = new AssistantMessageComponent(message, true);

		const hiddenThinking = component.render(80).map((line) => stripAnsi(line)).join("\n");
		assert.doesNotMatch(hiddenThinking, /Thinking\.\.\./);
		assert.doesNotMatch(hiddenThinking, /Private reasoning trace/);

		component.setHideThinkingBlock(false);
		const expandedThinking = component.render(80).map((line) => stripAnsi(line)).join("\n");

		assert.match(expandedThinking, /Private reasoning trace/);
		assert.doesNotMatch(expandedThinking, /Thinking\.\.\./);
	});
});

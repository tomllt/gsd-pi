import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
	beginTurnLatency,
	clearTurnLatencyRecordsForTest,
	finishTurnLatency,
	formatTurnLatencyRecords,
	formatTurnLatencySummary,
	getTurnLatencyRecords,
	markFirstStreamActivity,
	markFirstVisibleTurnLatency,
	markTurnLatency,
} from "./turn-latency.js";

describe("turn latency diagnostics", () => {
	beforeEach(() => {
		clearTurnLatencyRecordsForTest();
	});

	it("captures metadata-only marks and first signals once", () => {
		const record = beginTurnLatency({
			source: "interactive",
			trigger: "editor_submit",
			model: { provider: "anthropic", id: "claude-sonnet" } as any,
		});

		assert.ok(record);
		markTurnLatency(record, "session.prompt.enter", { hasImages: false });
		markFirstStreamActivity(record, "start");
		markFirstStreamActivity(record, "text_delta");
		markFirstVisibleTurnLatency(record, "text");
		markFirstVisibleTurnLatency(record, "tool");
		finishTurnLatency(record, "completed", {} as NodeJS.ProcessEnv);

		assert.equal(record.firstStreamActivity?.kind, "start");
		assert.equal(record.firstVisible?.kind, "text");
		assert.equal(record.status, "completed");

		const formatted = formatTurnLatencyRecords();
		assert.match(formatted, /model=anthropic\/claude-sonnet/);
		assert.match(formatted, /first_visible=\d+ms:text/);
		assert.match(formatted, /session\.prompt\.enter/);
		assert.doesNotMatch(formatted, /editor_submit.*hello/i);
	});

	it("keeps only the latest records", () => {
		for (let i = 0; i < 30; i++) {
			const record = beginTurnLatency({ source: "tui" });
			assert.ok(record);
			finishTurnLatency(record, "completed", {} as NodeJS.ProcessEnv);
		}

		const records = getTurnLatencyRecords();
		assert.equal(records.length, 25);
		assert.equal(records[0]?.id, "tui-turn-6");
		assert.equal(records.at(-1)?.id, "tui-turn-30");
	});

	it("ignores non-TUI sources", () => {
		assert.equal(beginTurnLatency({ source: "rpc" }), undefined);
		assert.equal(getTurnLatencyRecords().length, 0);
	});

	it("classifies slow first-visible latency in summaries", () => {
		const record = beginTurnLatency({ source: "tui" });
		assert.ok(record);
		record.startedAtMs -= 6_000;
		markFirstVisibleTurnLatency(record, "thinking");
		finishTurnLatency(record, "completed", {} as NodeJS.ProcessEnv);

		assert.match(formatTurnLatencySummary(record), /class=slow/);
	});
});

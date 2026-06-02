import type { Model } from "@gsd/pi-ai";

export type TurnLatencyStatus = "completed" | "queued" | "handled" | "error";
export type TurnLatencyVisibleKind = "text" | "thinking" | "tool" | "message_end_only";

export interface TurnLatencyMark {
	phase: string;
	atMs: number;
	data?: Record<string, unknown>;
}

export interface TurnLatencyFirstSignal {
	kind: string;
	atMs: number;
	data?: Record<string, unknown>;
}

export interface TurnLatencyRecord {
	id: string;
	source: "tui";
	startedAt: string;
	startedAtMs: number;
	provider?: string;
	model?: string;
	status?: TurnLatencyStatus;
	endedAtMs?: number;
	durationMs?: number;
	firstStreamActivity?: TurnLatencyFirstSignal;
	firstVisible?: TurnLatencyFirstSignal & { kind: TurnLatencyVisibleKind };
	marks: TurnLatencyMark[];
}

export interface BeginTurnLatencyOptions {
	source?: "interactive" | "tui" | string;
	model?: Model<any>;
	trigger?: string;
}

const MAX_RECORDS = 25;
const NOTICEABLE_MS = 2_000;
const SLOW_MS = 5_000;

let nextTurnLatencyId = 1;
const turnLatencyRecords: TurnLatencyRecord[] = [];

export function shouldTrackTurnLatency(source: string | undefined): boolean {
	return source === undefined || source === "interactive" || source === "tui";
}

export function isLiveTurnTimingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const value = (env.GSD_TUI_TIMING ?? "").toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}

export function beginTurnLatency(options: BeginTurnLatencyOptions = {}): TurnLatencyRecord | undefined {
	if (!shouldTrackTurnLatency(options.source)) return undefined;

	const now = performance.now();
	const record: TurnLatencyRecord = {
		id: `tui-turn-${nextTurnLatencyId++}`,
		source: "tui",
		startedAt: new Date().toISOString(),
		startedAtMs: now,
		provider: options.model?.provider,
		model: options.model?.id,
		marks: [],
	};
	turnLatencyRecords.push(record);
	while (turnLatencyRecords.length > MAX_RECORDS) {
		turnLatencyRecords.shift();
	}
	markTurnLatency(record, "turn.start", options.trigger ? { trigger: options.trigger } : undefined);
	return record;
}

export function markTurnLatency(
	record: TurnLatencyRecord | undefined,
	phase: string,
	data?: Record<string, unknown>,
): void {
	if (!record || record.endedAtMs !== undefined) return;
	record.marks.push({
		phase,
		atMs: elapsedSinceStart(record),
		...(data ? { data } : {}),
	});
}

export function updateTurnLatencyModel(record: TurnLatencyRecord | undefined, model: Model<any> | undefined): void {
	if (!record || !model) return;
	record.provider = model.provider;
	record.model = model.id;
}

export function markFirstStreamActivity(
	record: TurnLatencyRecord | undefined,
	kind: string,
	data?: Record<string, unknown>,
): void {
	if (!record || record.firstStreamActivity) return;
	record.firstStreamActivity = {
		kind,
		atMs: elapsedSinceStart(record),
		...(data ? { data } : {}),
	};
	markTurnLatency(record, "agent_loop.first_stream_activity", { kind, ...(data ?? {}) });
}

export function markFirstVisibleTurnLatency(
	record: TurnLatencyRecord | undefined,
	kind: TurnLatencyVisibleKind,
	data?: Record<string, unknown>,
): void {
	if (!record || record.firstVisible) return;
	record.firstVisible = {
		kind,
		atMs: elapsedSinceStart(record),
		...(data ? { data } : {}),
	};
	markTurnLatency(record, "tui.first_visible", { kind, ...(data ?? {}) });
}

export function finishTurnLatency(
	record: TurnLatencyRecord | undefined,
	status: TurnLatencyStatus,
	env: NodeJS.ProcessEnv = process.env,
): void {
	if (!record || record.endedAtMs !== undefined) return;
	record.status = status;
	markTurnLatency(record, "turn.end", { status });
	record.endedAtMs = performance.now();
	record.durationMs = Math.round(record.endedAtMs - record.startedAtMs);
	if (isLiveTurnTimingEnabled(env)) {
		process.stderr.write(`${formatTurnLatencySummary(record)}\n`);
	}
}

export function getTurnLatencyRecords(): readonly TurnLatencyRecord[] {
	return turnLatencyRecords;
}

export function clearTurnLatencyRecordsForTest(): void {
	turnLatencyRecords.length = 0;
	nextTurnLatencyId = 1;
}

export function formatTurnLatencyRecords(records: readonly TurnLatencyRecord[] = turnLatencyRecords): string {
	if (records.length === 0) return "No TUI turn latency records captured.";
	return records.map(formatTurnLatencyDetails).join("\n");
}

export function formatTurnLatencySummary(record: TurnLatencyRecord): string {
	const firstVisibleMs = record.firstVisible?.atMs;
	const firstStreamMs = record.firstStreamActivity?.atMs;
	const classification =
		firstVisibleMs === undefined ? "no-visible-output"
			: firstVisibleMs >= SLOW_MS ? "slow"
				: firstVisibleMs >= NOTICEABLE_MS ? "noticeable"
					: "ok";
	const provider = [record.provider, record.model].filter(Boolean).join("/");
	const parts = [
		`[gsd timing] ${record.id}`,
		`status=${record.status ?? "active"}`,
		provider ? `model=${provider}` : undefined,
		firstStreamMs !== undefined ? `first_stream=${Math.round(firstStreamMs)}ms` : "first_stream=n/a",
		firstVisibleMs !== undefined
			? `first_visible=${Math.round(firstVisibleMs)}ms:${record.firstVisible?.kind}`
			: "first_visible=n/a",
		record.durationMs !== undefined ? `duration=${record.durationMs}ms` : undefined,
		`class=${classification}`,
	];
	return parts.filter(Boolean).join(" ");
}

function formatTurnLatencyDetails(record: TurnLatencyRecord): string {
	const lines = [formatTurnLatencySummary(record)];
	for (const mark of record.marks) {
		const data = mark.data && Object.keys(mark.data).length > 0 ? ` ${JSON.stringify(mark.data)}` : "";
		lines.push(`  +${Math.round(mark.atMs)}ms ${mark.phase}${data}`);
	}
	return lines.join("\n");
}

function elapsedSinceStart(record: TurnLatencyRecord): number {
	return Math.round((performance.now() - record.startedAtMs) * 100) / 100;
}

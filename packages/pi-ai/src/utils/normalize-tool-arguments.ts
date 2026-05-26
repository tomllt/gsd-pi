/**
 * Normalize common LLM tool-argument mistakes before JSON-schema validation.
 *
 * Some models (notably Gemini Flash on Antigravity) emit valid-looking tool
 * calls with wrong shapes: `filePath`/`file` instead of `path`, or JSON-stringified
 * arrays for `subagent.tasks`. AJV type coercion does not repair these.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function aliasPathArguments(args: Record<string, unknown>): void {
	if (args.path !== undefined) return;
	const alias = args.filePath ?? args.file_path ?? args.file;
	if (typeof alias !== "string" || alias.length === 0) return;
	args.path = alias;
	delete args.filePath;
	delete args.file_path;
	delete args.file;
}

function tryParseJsonValue(value: string): unknown {
	const trimmed = value.trim();
	if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
		return value;
	}
	try {
		return JSON.parse(trimmed);
	} catch {
		return value;
	}
}

function normalizeJsonStringCollections(args: Record<string, unknown>, keys: readonly string[]): void {
	for (const key of keys) {
		const value = args[key];
		if (typeof value !== "string") continue;
		const parsed = tryParseJsonValue(value);
		if (parsed !== value) {
			args[key] = parsed;
		}
	}
}

/**
 * Apply tool-specific argument repairs in-place on a cloned args object.
 */
export function normalizeToolArguments(toolName: string, args: unknown): unknown {
	if (!isRecord(args)) {
		return args;
	}

	if (toolName === "read" || toolName === "write" || toolName === "edit") {
		aliasPathArguments(args);
	}

	if (toolName === "subagent") {
		normalizeJsonStringCollections(args, ["tasks", "chain"]);
	}

	return args;
}

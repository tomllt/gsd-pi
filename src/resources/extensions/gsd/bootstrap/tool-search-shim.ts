// GSD does not implement Anthropic deferred-tool ToolSearch. Models trained on
// that API sometimes try `select:mcp__<server>__<tool>` and get a hard
// "Tool ToolSearch not found" failure. This shim returns explicit call guidance.

import { createToolSearchShimResult, Type } from "@gsd/pi-ai";
export { parseToolSearchSelectQuery } from "@gsd/pi-ai";
import type { ExtensionAPI } from "@gsd/pi-coding-agent";
import { Text } from "@gsd/pi-tui";

export function registerToolSearchShim(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "ToolSearch",
		label: "Tool Search (guidance)",
		description:
			"Not supported in GSD. If the needed workflow tool is active, invoke the exact listed tool name " +
			"(e.g. gsd_save_gate_result, or the active MCP-scoped workflow name in Claude Code). Do not use ToolSearch.",
		parameters: Type.Object({
			query: Type.String({ description: "Ignored — use a direct tool call instead" }),
			max_results: Type.Optional(Type.Number()),
		}),
		async execute(_toolCallId, params) {
			return createToolSearchShimResult(params, { activeToolNames: pi.getActiveTools() });
		},
		renderCall(args: any, theme: any) {
			const q = args.query ?? "";
			return new Text(theme.fg("toolTitle", theme.bold("ToolSearch ")) + theme.fg("dim", q), 0, 0);
		},
		renderResult(result: any, _options: any, theme: any) {
			const text = result.content?.[0]?.text ?? "Use a direct tool call instead of ToolSearch.";
			return new Text(theme.fg("warning", text), 0, 0);
		},
	});

	const active = pi.getActiveTools();
	if (!active.includes("ToolSearch")) {
		pi.setActiveTools([...active, "ToolSearch"]);
	}
}

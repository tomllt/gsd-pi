import type { AgentTool } from "./types.js";

/**
 * Claude Code exposes PascalCase tool names (Bash, Glob, …) while Pi's built-ins
 * use lowercase names (bash, find, …). Models trained on CC often call the PascalCase
 * names even when only the Pi tools are registered.
 */
const CLAUDE_CODE_TOOL_ALIASES: Record<string, string> = {
	glob: "find",
};

/**
 * Resolve a tool call name against the active tool registry.
 * Matches exact name, case-insensitive name, then known CC aliases.
 */
export function resolveAgentTool(
	tools: AgentTool<any>[] | undefined,
	requestedName: string,
): AgentTool<any> | undefined {
	if (!tools?.length) {
		return undefined;
	}

	const direct = tools.find((tool) => tool.name === requestedName);
	if (direct) {
		return direct;
	}

	const lower = requestedName.toLowerCase();
	const caseInsensitive = tools.find((tool) => tool.name.toLowerCase() === lower);
	if (caseInsensitive) {
		return caseInsensitive;
	}

	const mappedName = CLAUDE_CODE_TOOL_ALIASES[lower];
	if (mappedName) {
		return tools.find((tool) => tool.name === mappedName);
	}

	return undefined;
}

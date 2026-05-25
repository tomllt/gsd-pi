import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeRegistry } from "./runtime-registry.js";
import { WORKFLOW_TOOL_NAMES } from "@opengsd/mcp-server";

const SERVER_NAME = "gsd-cloud-gateway";
const SERVER_VERSION = "1.0.2";

const SESSION_TOOL_NAMES = [
  "gsd_execute",
  "gsd_status",
  "gsd_result",
  "gsd_cancel",
  "gsd_query",
  "gsd_resolve_blocker",
  "gsd_progress",
  "gsd_roadmap",
  "gsd_history",
  "gsd_doctor",
  "gsd_captures",
  "gsd_knowledge",
  "gsd_graph",
] as const;

const CLOUD_PROJECTS_TOOL = "gsd_cloud_projects";

export const CLOUD_GATEWAY_TOOL_NAMES = [
  CLOUD_PROJECTS_TOOL,
  ...SESSION_TOOL_NAMES,
  ...WORKFLOW_TOOL_NAMES,
] as const;

const passthroughSchema = z.object({
  runtimeId: z.string().optional().describe("Connected Local GSD Runtime ID"),
  projectAlias: z.string().optional().describe("Gateway project alias advertised by the Local GSD Runtime"),
}).passthrough();

export function createGatewayMcpServer(params: {
  userId: string;
  registry: RuntimeRegistry;
}): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    CLOUD_PROJECTS_TOOL,
    {
      description: "List projects currently advertised by connected Local GSD Runtimes.",
      inputSchema: {},
    },
    async () => ({
      content: [{
        type: "text" as const,
        text: JSON.stringify({ projects: params.registry.listProjects(params.userId) }, null, 2),
      }],
    }),
  );

  const seen = new Set<string>([CLOUD_PROJECTS_TOOL]);
  for (const toolName of [...SESSION_TOOL_NAMES, ...WORKFLOW_TOOL_NAMES]) {
    if (seen.has(toolName)) continue;
    seen.add(toolName);
    server.registerTool(
      toolName,
      {
        description: `Forward ${toolName} to a connected Local GSD Runtime through the Cloud MCP Gateway.`,
        inputSchema: passthroughSchema,
      },
      async (args, extra) => {
        try {
          const result = await params.registry.callTool({
            userId: params.userId,
            toolName,
            args: args as Record<string, unknown>,
            signal: extra.signal,
          });
          if (isMcpToolResult(result)) return result as never;
          return {
            content: [{
              type: "text" as const,
              text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            }],
          };
        } catch (err) {
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text: err instanceof Error ? err.message : String(err),
            }],
          };
        }
      },
    );
  }

  return server;
}

function isMcpToolResult(value: unknown): value is {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent?: unknown;
} {
  return !!value
    && typeof value === "object"
    && Array.isArray((value as { content?: unknown }).content)
    && (value as { content: Array<{ type?: unknown; text?: unknown }> }).content.every(
      (item) => item.type === "text" && typeof item.text === "string",
    );
}

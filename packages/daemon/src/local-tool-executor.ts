import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import {
  readCaptures,
  readHistory,
  readKnowledge,
  readProgress,
  readRoadmap,
  buildGraph,
  graphDiff,
  graphQuery,
  graphStatus,
  registerWorkflowTools,
  resolveGsdRoot,
  runDoctorLite,
  writeGraph,
  writeSnapshot,
  WORKFLOW_TOOL_NAMES,
} from "@opengsd/mcp-server";
import type { SessionManager } from "./session-manager.js";
import type { ProjectInfo } from "./types.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
const WORKFLOW_TOOL_NAME_SET = new Set<string>(WORKFLOW_TOOL_NAMES);

export class LocalToolExecutor {
  private readonly workflowHandlers = new Map<string, ToolHandler>();

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly scanProjects: () => Promise<ProjectInfo[]>,
  ) {
    registerWorkflowTools({
      tool: (name: string, _description: string, _params: Record<string, unknown>, handler: ToolHandler) => {
        if (!WORKFLOW_TOOL_NAME_SET.has(name)) return;
        this.workflowHandlers.set(name, handler);
      },
    });
  }

  async execute(toolName: string, rawArgs: Record<string, unknown>, projectAlias?: string): Promise<unknown> {
    const args = { ...rawArgs };
    if (projectAlias) {
      args.projectDir = await this.resolveProjectPath(projectAlias);
    }

    const workflow = this.workflowHandlers.get(toolName);
    if (WORKFLOW_TOOL_NAME_SET.has(toolName)) {
      if (!workflow) throw new Error(`Unsupported forwarded GSD MCP tool: ${toolName}`);
      return this.executeWorkflowHandler(workflow, args);
    }

    switch (toolName) {
      case "gsd_execute": {
        const projectDir = await this.requiredProjectDir(args);
        const sessionId = await this.sessionManager.startSession({
          projectDir,
          command: typeof args.command === "string" ? args.command : undefined,
          model: typeof args.model === "string" ? args.model : undefined,
          bare: typeof args.bare === "boolean" ? args.bare : undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify({ sessionId, status: "started" }, null, 2) }] };
      }
      case "gsd_status": {
        const session = this.sessionManager.getSession(String(args.sessionId ?? ""));
        if (!session) throw new Error(`Session not found: ${String(args.sessionId ?? "")}`);
        return { content: [{ type: "text", text: JSON.stringify(this.sessionManager.getResult(session.sessionId), null, 2) }] };
      }
      case "gsd_result":
        return { content: [{ type: "text", text: JSON.stringify(this.sessionManager.getResult(String(args.sessionId ?? "")), null, 2) }] };
      case "gsd_cancel":
        if (typeof args.sessionId === "string") await this.sessionManager.cancelSession(args.sessionId);
        else await this.sessionManager.cancelSessionByDir(await this.requiredProjectDir(args));
        return { content: [{ type: "text", text: JSON.stringify({ cancelled: true }, null, 2) }] };
      case "gsd_resolve_blocker": {
        const sessionId = String(args.sessionId ?? "");
        const response = String(args.response ?? "");
        await this.sessionManager.resolveBlocker(sessionId, response);
        return { content: [{ type: "text", text: JSON.stringify({ resolved: true }, null, 2) }] };
      }
      case "gsd_query":
      case "gsd_progress":
        return { content: [{ type: "text", text: JSON.stringify(await readProgress(await this.requiredProjectDir(args)), null, 2) }] };
      case "gsd_roadmap":
        return { content: [{ type: "text", text: JSON.stringify(await readRoadmap(await this.requiredProjectDir(args)), null, 2) }] };
      case "gsd_history":
        return { content: [{ type: "text", text: JSON.stringify(await readHistory(await this.requiredProjectDir(args)), null, 2) }] };
      case "gsd_doctor":
        return { content: [{ type: "text", text: JSON.stringify(await runDoctorLite(await this.requiredProjectDir(args)), null, 2) }] };
      case "gsd_captures":
        return { content: [{ type: "text", text: JSON.stringify(await readCaptures(await this.requiredProjectDir(args)), null, 2) }] };
      case "gsd_knowledge":
        return { content: [{ type: "text", text: JSON.stringify(await readKnowledge(await this.requiredProjectDir(args)), null, 2) }] };
      case "gsd_graph":
        return { content: [{ type: "text", text: JSON.stringify(await this.executeGraph(args), null, 2) }] };
      default:
        throw new Error(`Unsupported forwarded GSD MCP tool: ${toolName}`);
    }
  }

  async advertisedProjects(): Promise<Array<{
    alias: string;
    path: string;
    repoIdentity: string;
    remoteLabel?: string;
    markers: string[];
  }>> {
    const projects = await this.scanProjects();
    return projects.map((project) => {
      const remoteLabel = gitRemote(project.path);
      return {
        alias: project.name,
        path: project.path,
        repoIdentity: identityFor(project.path, remoteLabel),
        ...(remoteLabel ? { remoteLabel } : {}),
        markers: project.markers,
      };
    });
  }

  private async requiredProjectDir(args: Record<string, unknown>): Promise<string> {
    const value = args.projectDir;
    if (typeof value === "string" && value.trim()) return this.resolveProjectPath(value);
    throw new Error("projectDir or projectAlias is required");
  }

  private async resolveProjectPath(aliasOrPath: string): Promise<string> {
    const projects = await this.scanProjects();
    const match = projects.find((project) => project.name === aliasOrPath || project.path === aliasOrPath);
    if (!match) throw new Error(`Project is not advertised by the Local GSD Runtime: ${aliasOrPath}`);
    return match.path;
  }

  private executeWorkflowHandler(handler: ToolHandler, args: Record<string, unknown>): Promise<unknown> {
    return handler(args);
  }

  private async executeGraph(args: Record<string, unknown>): Promise<unknown> {
    const projectDir = await this.requiredProjectDir(args);
    const mode = args.mode;
    switch (mode) {
      case "build": {
        const gsdRoot = resolveGsdRoot(projectDir);
        if (args.snapshot === true) {
          await writeSnapshot(gsdRoot).catch(() => { /* best-effort */ });
        }
        const graph = await buildGraph(projectDir);
        await writeGraph(gsdRoot, graph);
        return {
          built: true,
          nodeCount: graph.nodes.length,
          edgeCount: graph.edges.length,
          builtAt: graph.builtAt,
        };
      }
      case "query":
        return graphQuery(
          projectDir,
          typeof args.term === "string" ? args.term : "",
          typeof args.budget === "number" ? args.budget : undefined,
        );
      case "status":
        return graphStatus(projectDir);
      case "diff":
        return graphDiff(projectDir);
      default:
        throw new Error("gsd_graph mode must be one of: build, query, status, diff");
    }
  }
}

function gitRemote(projectPath: string): string | undefined {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: projectPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function identityFor(projectPath: string, remote?: string): string {
  return createHash("sha256").update(remote || `${basename(projectPath)}:${projectPath}`).digest("hex").slice(0, 12);
}

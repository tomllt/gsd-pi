import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@gsd/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Type, type TSchema } from "@sinclair/typebox";

import { resolveGsdBrowserMcpLaunchConfig, type GsdBrowserMcpLaunchConfig } from "../../shared/gsd-browser-cli.js";
import { buildMcpChildEnv } from "../../mcp-client/manager.js";

type ManagedBrowserToolResult = AgentToolResult<ManagedBrowserToolDetails> & { isError?: boolean };

interface ManagedBrowserToolDetails {
  engine: "gsd-browser";
  server: string;
  tool: string;
  mcpTool: string;
  sessionName?: string;
  projectRoot?: string;
  truncated?: boolean;
  outputLines?: number;
  outputBytes?: number;
  structuredContent?: unknown;
  mcpIsError?: boolean;
  error?: string;
}

interface ManagedConnection {
  client: Client;
  transport: StdioClientTransport;
  launch: GsdBrowserMcpLaunchConfig;
}

interface McpContentItem {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  [key: string]: unknown;
}

interface ManagedBrowserToolSpec {
  name: string;
  mcpTools?: string[];
  label: string;
  description: string;
  parameters: TSchema;
  promptGuidelines?: string[];
  compatibility?: { producesImages?: boolean };
}

const connections = new Map<string, ManagedConnection>();
const pendingConnections = new Map<string, Promise<ManagedConnection>>();
const DEFAULT_MAX_LINES = 2_000;
const DEFAULT_MAX_BYTES = 50 * 1024;

const AssertionCheck = Type.Object({
  kind: Type.String({ description: "Assertion kind, e.g. url_contains, text_visible, selector_visible, no_console_errors, no_failed_requests." }),
  selector: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  value: Type.Optional(Type.String()),
  checked: Type.Optional(Type.Boolean()),
  sinceActionId: Type.Optional(Type.Number()),
}, { additionalProperties: true });

const BatchStep = Type.Object({
  action: Type.String({ description: "Step action, e.g. navigate, click, type, wait_for, assert, click_ref, fill_ref." }),
  selector: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  url: Type.Optional(Type.String()),
  key: Type.Optional(Type.String()),
  condition: Type.Optional(Type.String()),
  value: Type.Optional(Type.String()),
  threshold: Type.Optional(Type.String()),
  timeout: Type.Optional(Type.Number()),
  clearFirst: Type.Optional(Type.Boolean()),
  submit: Type.Optional(Type.Boolean()),
  ref: Type.Optional(Type.String()),
  checks: Type.Optional(Type.Array(AssertionCheck)),
}, { additionalProperties: true });

export const MANAGED_GSD_BROWSER_TOOL_NAMES = [
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_fill_form",
  "browser_click_ref",
  "browser_fill_ref",
  "browser_wait_for",
  "browser_assert",
  "browser_verify",
  "browser_screenshot",
  "browser_snapshot_refs",
  "browser_find",
  "browser_get_console_logs",
  "browser_get_network_logs",
  "browser_evaluate",
  "browser_reload",
  "browser_batch",
  "browser_act",
] as const;

const MANAGED_BROWSER_TOOLS: ManagedBrowserToolSpec[] = [
  {
    name: "browser_navigate",
    label: "Browser Navigate",
    description: "Navigate the managed gsd-browser session to a URL and return page state. Use for local web app verification and UAT evidence.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to navigate to, e.g. http://localhost:3000." }),
      screenshot: Type.Optional(Type.Boolean({ description: "Capture screenshot evidence when supported." })),
    }, { additionalProperties: true }),
  },
  {
    name: "browser_click",
    label: "Browser Click",
    description: "Click an element in the managed gsd-browser session by selector or coordinates.",
    parameters: Type.Object({
      selector: Type.Optional(Type.String({ description: "CSS selector to click." })),
      x: Type.Optional(Type.Number({ description: "X coordinate to click." })),
      y: Type.Optional(Type.Number({ description: "Y coordinate to click." })),
    }, { additionalProperties: true }),
  },
  {
    name: "browser_type",
    label: "Browser Type",
    description: "Type or fill text into an input in the managed gsd-browser session.",
    parameters: Type.Object({
      selector: Type.Optional(Type.String({ description: "CSS selector of the input to type into." })),
      text: Type.String({ description: "Text to enter." }),
      clearFirst: Type.Optional(Type.Boolean({ description: "Clear existing text first." })),
      submit: Type.Optional(Type.Boolean({ description: "Press Enter after typing." })),
      slowly: Type.Optional(Type.Boolean({ description: "Type character by character." })),
    }, { additionalProperties: true }),
  },
  {
    name: "browser_fill_form",
    label: "Browser Fill Form",
    description: "Fill a form in the managed gsd-browser session using field labels, names, placeholders, or aria labels.",
    parameters: Type.Object({
      selector: Type.Optional(Type.String({ description: "CSS selector targeting the form." })),
      values: Type.Record(Type.String(), Type.String(), { description: "Field identifier to value mapping." }),
      submit: Type.Optional(Type.Boolean({ description: "Submit the form after filling." })),
    }, { additionalProperties: true }),
  },
  {
    name: "browser_click_ref",
    label: "Browser Click Ref",
    description: "Click a versioned ref from the latest gsd-browser snapshot.",
    parameters: Type.Object({
      ref: Type.String({ description: "Versioned ref, e.g. @v3:e2." }),
    }, { additionalProperties: true }),
  },
  {
    name: "browser_fill_ref",
    label: "Browser Fill Ref",
    description: "Fill text into an input-like versioned ref from the latest gsd-browser snapshot.",
    parameters: Type.Object({
      ref: Type.String({ description: "Versioned ref, e.g. @v3:e1." }),
      text: Type.String({ description: "Text to enter." }),
      clearFirst: Type.Optional(Type.Boolean({ description: "Clear existing text first." })),
      submit: Type.Optional(Type.Boolean({ description: "Press Enter after filling." })),
      slowly: Type.Optional(Type.Boolean({ description: "Type character by character." })),
    }, { additionalProperties: true }),
  },
  {
    name: "browser_wait_for",
    label: "Browser Wait For",
    description: "Wait for a browser condition such as network idle, selector visibility, text visibility, or URL change.",
    parameters: Type.Object({
      condition: Type.String({ description: "Condition, e.g. network_idle, selector_visible, text_visible, url_contains." }),
      value: Type.Optional(Type.String({ description: "Selector, text, URL substring, or delay value depending on condition." })),
      threshold: Type.Optional(Type.String({ description: "Threshold expression for count-based conditions." })),
      timeout: Type.Optional(Type.Number({ description: "Maximum milliseconds to wait." })),
    }, { additionalProperties: true }),
  },
  {
    name: "browser_assert",
    label: "Browser Assert",
    description: "Run explicit browser assertions and return structured PASS/FAIL evidence.",
    promptGuidelines: [
      "Prefer browser_assert for final browser verification instead of inferring success from summaries.",
      "Use checks for URL, text, selector state, value, and browser diagnostics whenever those signals are available.",
    ],
    parameters: Type.Object({
      checks: Type.Array(AssertionCheck),
    }, { additionalProperties: true }),
  },
  {
    name: "browser_verify",
    label: "Browser Verify",
    description: "Run a structured browser verification flow and return evidence from the managed gsd-browser session.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to verify." }),
      checks: Type.Array(Type.Object({
        description: Type.String({ description: "What this check verifies." }),
        selector: Type.Optional(Type.String()),
        expectedText: Type.Optional(Type.String()),
        expectedVisible: Type.Optional(Type.Boolean()),
        screenshot: Type.Optional(Type.Boolean()),
      }, { additionalProperties: true })),
      timeout: Type.Optional(Type.Number({ description: "Navigation timeout in milliseconds." })),
    }, { additionalProperties: true }),
  },
  {
    name: "browser_screenshot",
    label: "Browser Screenshot",
    description: "Capture browser screenshot evidence from the managed gsd-browser session.",
    compatibility: { producesImages: true },
    parameters: Type.Object({
      fullPage: Type.Optional(Type.Boolean({ description: "Capture the full scrollable page." })),
      selector: Type.Optional(Type.String({ description: "CSS selector to crop." })),
      quality: Type.Optional(Type.Number({ description: "JPEG quality when supported." })),
    }, { additionalProperties: true }),
  },
  {
    name: "browser_snapshot_refs",
    mcpTools: ["browser_snapshot", "browser_snapshot_refs"],
    label: "Browser Snapshot Refs",
    description: "Capture a compact gsd-browser snapshot with versioned refs for reliable interaction.",
    parameters: Type.Object({
      selector: Type.Optional(Type.String({ description: "Optional CSS selector scope." })),
      interactiveOnly: Type.Optional(Type.Boolean({ description: "Compatibility flag; use mode for gsd-browser filtering." })),
      limit: Type.Optional(Type.Number({ description: "Maximum elements to include." })),
      mode: Type.Optional(Type.String({ description: "Snapshot mode: interactive, form, dialog, navigation, errors, headings, visible_only." })),
    }, { additionalProperties: true }),
  },
  {
    name: "browser_find",
    mcpTools: ["browser_find_element", "browser_find"],
    label: "Browser Find",
    description: "Find elements by text, role, or selector in the managed gsd-browser session.",
    parameters: Type.Object({
      text: Type.Optional(Type.String({ description: "Visible text to find." })),
      role: Type.Optional(Type.String({ description: "ARIA role to filter by." })),
      selector: Type.Optional(Type.String({ description: "CSS selector to scope or match." })),
      limit: Type.Optional(Type.Number({ description: "Maximum results to return." })),
    }, { additionalProperties: true }),
  },
  {
    name: "browser_get_console_logs",
    mcpTools: ["browser_console", "browser_get_console_logs"],
    label: "Browser Console Logs",
    description: "Return buffered console logs and JavaScript errors from the managed gsd-browser session.",
    parameters: Type.Object({
      clear: Type.Optional(Type.Boolean({ description: "Clear the buffer after reading logs." })),
    }, { additionalProperties: true }),
  },
  {
    name: "browser_get_network_logs",
    mcpTools: ["browser_network", "browser_get_network_logs"],
    label: "Browser Network Logs",
    description: "Return buffered network requests and responses from the managed gsd-browser session.",
    parameters: Type.Object({
      clear: Type.Optional(Type.Boolean({ description: "Clear the buffer after reading logs." })),
      filter: Type.Optional(Type.String({ description: "Filter, e.g. all, errors, fetch-xhr." })),
    }, { additionalProperties: true }),
  },
  {
    name: "browser_evaluate",
    mcpTools: ["browser_eval", "browser_evaluate"],
    label: "Browser Evaluate",
    description: "Evaluate a JavaScript expression in the managed gsd-browser page context.",
    parameters: Type.Object({
      expression: Type.String({ description: "JavaScript expression to evaluate." }),
    }, { additionalProperties: true }),
  },
  {
    name: "browser_reload",
    label: "Browser Reload",
    description: "Reload the current page in the managed gsd-browser session.",
    parameters: Type.Object({}, { additionalProperties: true }),
  },
  {
    name: "browser_batch",
    label: "Browser Batch",
    description: "Execute multiple explicit browser steps through the managed gsd-browser session in one call.",
    promptGuidelines: [
      "Use browser_batch for obvious low-risk sequences like navigate, snapshot, click, type, wait, assert.",
      "Keep browser_batch steps explicit; do not use it as a speculative planner.",
    ],
    parameters: Type.Object({
      steps: Type.Array(BatchStep),
      stopOnFailure: Type.Optional(Type.Boolean({ description: "Stop after the first failing step." })),
      finalSummaryOnly: Type.Optional(Type.Boolean({ description: "Return only the compact final summary." })),
    }, { additionalProperties: true }),
  },
  {
    name: "browser_act",
    label: "Browser Act",
    description: "Execute a semantic browser action through gsd-browser, such as primary_cta, submit_form, or close_dialog.",
    parameters: Type.Object({
      intent: Type.String({ description: "Semantic intent, e.g. submit_form, close_dialog, primary_cta, search_field, accept_cookies." }),
      scope: Type.Optional(Type.String({ description: "CSS selector to narrow the search area." })),
    }, { additionalProperties: true }),
  },
];

function resolveProjectRoot(ctx?: ExtensionContext): string {
  return ctx?.cwd || process.cwd();
}

function resolveManagedSessionSuffix(ctx?: ExtensionContext): string {
  const explicit = process.env.GSD_BROWSER_SESSION_SUFFIX?.trim() || process.env.GSD_BROWSER_SESSION_ID?.trim();
  if (explicit) return explicit;

  try {
    const sessionId = ctx?.sessionManager?.getSessionId?.();
    if (sessionId) return `pi-${sessionId.slice(0, 12)}`;
  } catch {
    // Fall back to pid below when session metadata is unavailable.
  }

  return `pi-${process.pid}`;
}

function buildConnectionKey(launch: GsdBrowserMcpLaunchConfig): string {
  return JSON.stringify({
    command: launch.command,
    args: launch.args,
    cwd: launch.cwd,
    env: launch.env ?? {},
  });
}

async function connectManagedGsdBrowser(
  launch: GsdBrowserMcpLaunchConfig,
  signal?: AbortSignal,
): Promise<ManagedConnection> {
  const client = new Client({ name: "gsd-pi-browser-tools", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env: buildMcpChildEnv(launch.env),
    cwd: launch.cwd,
    stderr: "pipe",
  });

  try {
    await client.connect(transport, { signal, timeout: 30000 });
    return { client, transport, launch };
  } catch (error) {
    try {
      await transport.close();
    } catch {
      // Best-effort cleanup after a failed or aborted connection attempt.
    }
    try {
      await client.close();
    } catch {
      // Best-effort cleanup after a failed or aborted connection attempt.
    }
    throw error;
  }
}

async function getOrConnectManagedGsdBrowser(
  ctx?: ExtensionContext,
  signal?: AbortSignal,
): Promise<ManagedConnection> {
  const launch = resolveGsdBrowserMcpLaunchConfig(resolveProjectRoot(ctx), process.env, {
    sessionSuffix: resolveManagedSessionSuffix(ctx),
  });
  const key = buildConnectionKey(launch);
  const existing = connections.get(key);
  if (existing) return existing;

  const pending = pendingConnections.get(key);
  if (pending) return pending;

  const connectionPromise = connectManagedGsdBrowser(launch, signal);
  pendingConnections.set(key, connectionPromise);
  try {
    const connection = await connectionPromise;
    connections.set(key, connection);
    return connection;
  } finally {
    pendingConnections.delete(key);
  }
}

function isUnknownMcpToolError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unknown tool|tool .*not found|tool not found|not registered|does not exist/i.test(message);
}

function normalizeManagedArgs(piToolName: string, args: Record<string, unknown>): Record<string, unknown> {
  if (piToolName === "browser_snapshot_refs") {
    const { interactiveOnly: _interactiveOnly, ...snapshotArgs } = args;
    return snapshotArgs;
  }
  return args;
}

function serializeMcpContent(
  contentItems: McpContentItem[],
): { content: ManagedBrowserToolResult["content"]; truncated: boolean; outputLines: number; outputBytes: number } {
  const imageItems: Array<{ type: "image"; data: string; mimeType: string }> = [];
  const textParts: string[] = [];

  for (const item of contentItems) {
    if (item.type === "text") {
      textParts.push(item.text ?? "");
      continue;
    }
    if (item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string") {
      imageItems.push({ type: "image", data: item.data, mimeType: item.mimeType });
      textParts.push(`[image evidence: ${item.mimeType}]`);
      continue;
    }
    textParts.push(JSON.stringify(item));
  }

  const rawText = textParts.filter((part) => part.length > 0).join("\n");
  const truncation = truncateHeadText(rawText, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  let finalText = truncation.content;
  if (truncation.truncated) {
    finalText += `\n\n[Output truncated: ${truncation.outputLines}/${truncation.totalLines} lines (${formatByteSize(truncation.outputBytes)} of ${formatByteSize(truncation.totalBytes)})]`;
  }

  let content: ManagedBrowserToolResult["content"];
  if (finalText) {
    content = [{ type: "text", text: finalText }, ...imageItems];
  } else if (imageItems.length > 0) {
    content = imageItems;
  } else {
    content = [{ type: "text", text: "gsd-browser returned no content." }];
  }

  return {
    content,
    truncated: truncation.truncated,
    outputLines: truncation.outputLines,
    outputBytes: truncation.outputBytes,
  };
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncateHeadText(
  text: string,
  options: { maxLines: number; maxBytes: number },
): { content: string; truncated: boolean; outputLines: number; totalLines: number; outputBytes: number; totalBytes: number } {
  const totalBytes = Buffer.byteLength(text, "utf-8");
  const allLines = text.split(/\r?\n/);
  const totalLines = text.length === 0 ? 0 : allLines.length;
  let content = allLines.slice(0, options.maxLines).join("\n");

  while (Buffer.byteLength(content, "utf-8") > options.maxBytes && content.length > 0) {
    content = content.slice(0, Math.max(0, content.length - 1024));
  }

  const outputBytes = Buffer.byteLength(content, "utf-8");
  const outputLines = content.length === 0 ? 0 : content.split(/\r?\n/).length;
  return {
    content,
    truncated: outputLines < totalLines || outputBytes < totalBytes,
    outputLines,
    totalLines,
    outputBytes,
    totalBytes,
  };
}

async function callManagedGsdBrowserTool(
  piToolName: string,
  mcpTools: string[],
  args: Record<string, unknown>,
  options: { signal?: AbortSignal; ctx?: ExtensionContext },
): Promise<ManagedBrowserToolResult> {
  const connection = await getOrConnectManagedGsdBrowser(options.ctx, options.signal);
  const normalizedArgs = normalizeManagedArgs(piToolName, args);
  let lastError: unknown;

  for (const mcpTool of mcpTools) {
    try {
      const result = await connection.client.callTool(
        { name: mcpTool, arguments: normalizedArgs },
        undefined,
        { signal: options.signal, timeout: 60000 },
      );
      const contentItems = Array.isArray(result.content) ? result.content as McpContentItem[] : [];
      const serialized = serializeMcpContent(contentItems);

      return {
        content: serialized.content,
        details: {
          engine: "gsd-browser",
          server: connection.launch.serverName,
          tool: piToolName,
          mcpTool,
          sessionName: connection.launch.sessionName,
          projectRoot: connection.launch.projectRoot,
          truncated: serialized.truncated,
          outputLines: serialized.outputLines,
          outputBytes: serialized.outputBytes,
          structuredContent: (result as { structuredContent?: unknown }).structuredContent,
          mcpIsError: Boolean((result as { isError?: boolean }).isError),
        },
        isError: Boolean((result as { isError?: boolean }).isError),
      };
    } catch (error) {
      lastError = error;
      if (!isUnknownMcpToolError(error)) break;
    }
  }

  throw lastError;
}

function formatManagedBrowserError(toolName: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return [
    `gsd-browser engine or tool unavailable for ${toolName}: ${message}`,
    "",
    "GSD browser automation now uses the managed gsd-browser engine by default.",
    "Run /gsd doctor or reinstall dependencies so @opengsd/gsd-browser is available.",
    "Set GSD_BROWSER_ENGINE=legacy only when you intentionally need the Playwright compatibility engine.",
  ].join("\n");
}

/**
 * Eagerly establish the managed gsd-browser connection so browser tools are
 * ready before first use. Best-effort: returns the error instead of throwing so
 * callers (e.g. session-start warm-up) can surface a warning without failing the
 * session. Connecting only spawns the gsd-browser MCP daemon; it does not launch
 * Chrome (that happens lazily on the first navigation).
 */
export async function warmUpManagedGsdBrowser(
  ctx?: ExtensionContext,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await getOrConnectManagedGsdBrowser(ctx, signal);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function registerManagedGsdBrowserTools(pi: ExtensionAPI): void {
  for (const tool of MANAGED_BROWSER_TOOLS) {
    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      ...(tool.promptGuidelines ? { promptGuidelines: tool.promptGuidelines } : {}),
      ...(tool.compatibility ? { compatibility: tool.compatibility } : {}),
      parameters: tool.parameters,
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        try {
          return await callManagedGsdBrowserTool(
            tool.name,
            tool.mcpTools ?? [tool.name],
            params as Record<string, unknown>,
            { signal, ctx },
          );
        } catch (error) {
          const message = formatManagedBrowserError(tool.name, error);
          return {
            content: [{ type: "text", text: message }],
            details: {
              engine: "gsd-browser",
              server: "gsd-browser",
              tool: tool.name,
              mcpTool: tool.mcpTools?.[0] ?? tool.name,
              error: error instanceof Error ? error.message : String(error),
            },
            isError: true,
          };
        }
      },
    });
  }
}

export async function closeManagedGsdBrowser(): Promise<void> {
  const closing = Array.from(connections.entries()).map(async ([key, connection]) => {
    try {
      await connection.client.close();
    } catch {
      // Best-effort cleanup.
    }
    try {
      await connection.transport.close();
    } catch {
      // Best-effort cleanup.
    }
    connections.delete(key);
  });
  await Promise.allSettled(closing);
  pendingConnections.clear();
}

export async function _resetManagedGsdBrowserForTest(): Promise<void> {
  await closeManagedGsdBrowser();
}

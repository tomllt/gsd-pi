import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createGatewayMcpServer } from "./mcp.js";
import { extractBearerToken, FileAuthStore, InMemoryAuthStore } from "./auth-store.js";
import { RuntimeRegistry } from "./runtime-registry.js";

export interface GatewayServerOptions {
  port?: number;
  host?: string;
  userToken?: string;
  userId?: string;
  authStorePath?: string;
}

export function createGatewayServer(options: GatewayServerOptions = {}) {
  const userId = options.userId ?? "local-user";
  const userToken = options.userToken ?? process.env.GSD_CLOUD_USER_TOKEN;
  if (!userToken) {
    throw new Error("GSD_CLOUD_USER_TOKEN is required");
  }
  const authStorePath = options.authStorePath ?? process.env.GSD_CLOUD_AUTH_STORE_PATH;
  const auth = authStorePath
    ? new FileAuthStore(authStorePath, { token: userToken, userId })
    : new InMemoryAuthStore({ token: userToken, userId });
  const registry = new RuntimeRegistry();
  const wss = new WebSocketServer({ noServer: true });

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/healthz") {
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === "POST" && req.url === "/pairing-codes") {
        const authedUser = requireUser(req, auth);
        if (!authedUser) return sendJson(res, 401, { error: "Unauthorized" });
        return sendJson(res, 200, auth.createPairingCode(authedUser));
      }

      if (req.method === "POST" && req.url === "/pairing/exchange") {
        const body = await readJson(req);
        const code = typeof body.code === "string" ? body.code : "";
        const runtimeName = typeof body.runtimeName === "string" ? body.runtimeName : undefined;
        try {
          return sendJson(res, 200, auth.exchangePairingCode(code, runtimeName));
        } catch {
          return sendJson(res, 400, { error: "Pairing code is invalid or expired" });
        }
      }

      if (req.url?.startsWith("/mcp")) {
        const authedUser = requireUser(req, auth);
        if (!authedUser) return sendJson(res, 401, { error: "Unauthorized" });
        const body = req.method === "POST" ? await readJson(req) : undefined;
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        const mcp = createGatewayMcpServer({ userId: authedUser, registry });
        await mcp.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      if (err instanceof BadRequestError) {
        return sendJson(res, 400, { error: err.message });
      }
      sendJson(res, 500, { error: "Internal server error" });
    }
  });

  server.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/runtime/connect") {
        socket.destroy();
        return;
      }
      const deviceToken = extractBearerToken(req.headers.authorization);
      const device = auth.authenticateDevice(deviceToken);
      if (!device) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        registry.attachRuntime({
          userId: device.userId,
          runtimeId: device.runtimeId,
          runtimeName: device.runtimeName,
          socket: ws,
        });
        ws.send(JSON.stringify({ type: "connected", requestId: randomUUID(), runtimeId: device.runtimeId }));
      });
    } catch {
      socket.destroy();
    }
  });

  return { server, auth, registry };
}

export async function listenGateway(options: GatewayServerOptions = {}): Promise<{
  close: () => Promise<void>;
  url: string;
}> {
  const { server } = createGatewayServer(options);
  const port = options.port ?? Number(process.env.PORT ?? 8787);
  const host = options.host ?? "0.0.0.0";
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  return {
    url: `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}

function requireUser(req: IncomingMessage, auth: InMemoryAuthStore): string | null {
  return auth.authenticateUser(extractBearerToken(req.headers.authorization));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    throw new BadRequestError("Invalid JSON request body");
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

class BadRequestError extends Error {}

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createGatewayServer } from "./server.js";

test("gateway requires an explicit user bearer token", () => {
  const prior = process.env.GSD_CLOUD_USER_TOKEN;
  delete process.env.GSD_CLOUD_USER_TOKEN;
  try {
    assert.throws(() => createGatewayServer(), /GSD_CLOUD_USER_TOKEN is required/);
  } finally {
    if (prior === undefined) delete process.env.GSD_CLOUD_USER_TOKEN;
    else process.env.GSD_CLOUD_USER_TOKEN = prior;
  }
});

test("gateway does not expose unexpected error details in HTTP responses", async () => {
  const { server, auth } = createGatewayServer({ userToken: "user-token" });
  auth.authenticateUser = () => {
    throw new Error("stack detail: secret-token");
  };

  const response = await dispatch(server, {
    method: "POST",
    url: "/pairing-codes",
    headers: { authorization: "Bearer user-token" },
  });
  assert.equal(response.status, 500);
  assert.deepEqual(JSON.parse(response.body) as unknown, { error: "Internal server error" });
});

test("gateway reports invalid JSON as a client error", async () => {
  const { server } = createGatewayServer({ userToken: "user-token" });
  const response = await dispatch(server, {
    method: "POST",
    url: "/mcp",
    headers: { authorization: "Bearer user-token" },
    chunks: ["{"],
  });
  assert.equal(response.status, 400);
  assert.deepEqual(JSON.parse(response.body) as unknown, { error: "Invalid JSON request body" });
});

test("runtime websocket rejects device tokens supplied in the URL query", () => {
  const { server, auth } = createGatewayServer({ userToken: "user-token" });
  const { code } = auth.createPairingCode("local-user");
  const issued = auth.exchangePairingCode(code, "Laptop");
  const socket = new MockUpgradeSocket();

  server.emit(
    "upgrade",
    {
      url: `/runtime/connect?device_token=${encodeURIComponent(issued.deviceToken)}`,
      headers: {},
    },
    socket,
    Buffer.alloc(0),
  );

  assert.match(socket.output, /401 Unauthorized/);
  assert.equal(socket.destroyed, true);
});

async function dispatch(
  server: ReturnType<typeof createGatewayServer>["server"],
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    chunks?: string[];
  },
): Promise<{ status: number; body: string }> {
  const req = new MockRequest(request);
  const res = new MockResponse();
  server.emit("request", req, res);
  return res.done;
}

class MockRequest extends EventEmitter {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  private readonly chunks: string[];

  constructor(params: { method: string; url: string; headers: Record<string, string>; chunks?: string[] }) {
    super();
    this.method = params.method;
    this.url = params.url;
    this.headers = params.headers;
    this.chunks = params.chunks ?? [];
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<Buffer> {
    for (const chunk of this.chunks) yield Buffer.from(chunk);
  }
}

class MockResponse extends EventEmitter {
  headersSent = false;
  private status = 0;
  private resolveDone!: (value: { status: number; body: string }) => void;
  readonly done = new Promise<{ status: number; body: string }>((resolve) => {
    this.resolveDone = resolve;
  });

  writeHead(status: number): void {
    this.status = status;
    this.headersSent = true;
  }

  end(body: string): void {
    this.resolveDone({ status: this.status, body });
  }
}

class MockUpgradeSocket extends EventEmitter {
  output = "";
  destroyed = false;

  write(chunk: string): void {
    this.output += chunk;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

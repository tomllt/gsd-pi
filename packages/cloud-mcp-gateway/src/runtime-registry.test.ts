import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { RuntimeRegistry } from "./runtime-registry.js";

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: unknown[] = [];
  send(payload: string): void {
    this.sent.push(JSON.parse(payload) as unknown);
  }
  close(): void {
    this.readyState = 3;
    this.emit("close");
  }
}

test("runtime registry tracks project advertisements and disconnects", () => {
  const registry = new RuntimeRegistry();
  const socket = new FakeSocket();
  registry.attachRuntime({ userId: "u1", runtimeId: "rt1", socket: socket as never });
  socket.emit("message", JSON.stringify({
    type: "hello",
    runtimeId: "rt1",
    projects: [{ alias: "app", repoIdentity: "abc123" }],
  }));
  assert.deepEqual(registry.listProjects("u1").map((p) => ({
    alias: p.alias,
    runtimeId: p.runtimeId,
    online: p.online,
  })), [{ alias: "app", runtimeId: "rt1", online: true }]);
  socket.close();
  assert.deepEqual(registry.listProjects("u1"), []);
});

test("runtime registry fails fast when no runtime is online", async () => {
  const registry = new RuntimeRegistry();
  await assert.rejects(
    registry.callTool({ userId: "u1", toolName: "gsd_status", args: { sessionId: "s1" } }),
    /No Local GSD Runtime is connected/,
  );
});

test("runtime registry serializes calls per project", async () => {
  const registry = new RuntimeRegistry();
  const socket = new FakeSocket();
  registry.attachRuntime({ userId: "u1", runtimeId: "rt1", socket: socket as never });
  socket.emit("message", JSON.stringify({
    type: "hello",
    runtimeId: "rt1",
    projects: [{ alias: "app", repoIdentity: "abc123" }],
  }));

  const first = registry.callTool({ userId: "u1", toolName: "gsd_status", args: { projectAlias: "app" } });
  const second = registry.callTool({ userId: "u1", toolName: "gsd_status", args: { projectAlias: "app" } });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socket.sent.length, 1);
  const firstCall = socket.sent[0] as { requestId: string };
  socket.emit("message", JSON.stringify({ type: "tool_result", requestId: firstCall.requestId, result: { n: 1 } }));
  assert.deepEqual(await first, { n: 1 });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socket.sent.length, 2);
  const secondCall = socket.sent[1] as { requestId: string };
  socket.emit("message", JSON.stringify({ type: "tool_result", requestId: secondCall.requestId, result: { n: 2 } }));
  assert.deepEqual(await second, { n: 2 });
});

test("runtime registry rejects in-flight calls when runtime disconnects", async () => {
  const registry = new RuntimeRegistry();
  const socket = new FakeSocket();
  registry.attachRuntime({ userId: "u1", runtimeId: "rt1", socket: socket as never });

  const call = registry.callTool({ userId: "u1", toolName: "gsd_status", args: { sessionId: "s1" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socket.sent.length, 1);

  const rejection = assert.rejects(call, /Local GSD Runtime disconnected: rt1 while waiting for gsd_status/);
  socket.close();
  await rejection;
});

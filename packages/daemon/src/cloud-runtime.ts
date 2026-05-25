import WebSocket from "ws";
import type { Logger } from "./logger.js";
import type { DaemonConfig } from "./types.js";
import type { LocalToolExecutor } from "./local-tool-executor.js";
import { createGatewayLookup, parseCloudGatewayUrl, validateGatewayNetworkTarget } from "./cloud-config.js";

interface GatewayMessage {
  type: string;
  requestId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  projectAlias?: string;
}

export class CloudRuntime {
  private socket: WebSocket | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private readonly cloud: NonNullable<DaemonConfig["cloud"]>,
    private readonly executor: LocalToolExecutor,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnect) clearTimeout(this.reconnect);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.socket?.close();
  }

  private connect(): void {
    if (!this.cloud.device_token || !this.cloud.runtime_id) {
      this.logger.warn("cloud runtime skipped — missing device token or runtime id");
      return;
    }
    const gatewayUrl = parseCloudGatewayUrl(this.cloud.gateway_url);
    try {
      validateGatewayNetworkTarget(gatewayUrl);
    } catch (err) {
      this.logger.warn("cloud runtime skipped unsafe gateway URL", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const url = new URL("/runtime/connect", gatewayUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url, {
      headers: { Authorization: `Bearer ${this.cloud.device_token}` },
      lookup: createGatewayLookup(gatewayUrl),
    });
    this.socket = socket;

    socket.on("open", () => {
      this.logger.info("cloud runtime connected", { gateway_url: this.cloud.gateway_url, runtime_id: this.cloud.runtime_id });
      void this.advertiseProjects();
      this.heartbeat = setInterval(() => this.send({ type: "heartbeat", at: Date.now() }), 30_000);
    });
    socket.on("message", (data) => void this.handleMessage(data.toString("utf8")));
    socket.on("close", () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = undefined;
      if (!this.stopped) {
        this.logger.warn("cloud runtime disconnected; reconnecting");
        this.reconnect = setTimeout(() => this.connect(), 5_000);
      }
    });
    socket.on("error", (err) => {
      this.logger.warn("cloud runtime socket error", { error: err.message });
    });
  }

  private async advertiseProjects(): Promise<void> {
    const projects = await this.executor.advertisedProjects();
    this.send({
      type: "hello",
      runtimeId: this.cloud.runtime_id,
      runtimeName: this.cloud.runtime_name,
      projects,
    });
  }

  private async handleMessage(text: string): Promise<void> {
    let message: GatewayMessage;
    try {
      message = JSON.parse(text) as GatewayMessage;
    } catch {
      return;
    }
    if (message.type !== "tool_call" || !message.requestId || !message.toolName) return;
    try {
      const result = await this.executor.execute(message.toolName, message.args ?? {}, message.projectAlias);
      this.send({ type: "tool_result", requestId: message.requestId, result });
    } catch (err) {
      this.send({
        type: "tool_result",
        requestId: message.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}

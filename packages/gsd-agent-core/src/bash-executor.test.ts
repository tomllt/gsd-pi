import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { executeBashWithOperations } from "./bash-executor.ts";
import type { BashOperations } from "@gsd/pi-coding-agent/core/tools/bash.js";

describe("executeBashWithOperations", () => {
  test("returns sanitized output and exit code", async () => {
    const operations: BashOperations = {
      exec: async (_command, _cwd, options) => {
        options?.onData?.(Buffer.from("hello\n"));
        return { exitCode: 0 };
      },
    };

    const result = await executeBashWithOperations("echo hello", "/tmp", operations);
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /hello/);
    assert.equal(result.cancelled, false);
  });

  test("marks cancelled executions when signal aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const operations: BashOperations = {
      exec: async () => {
        throw new Error("aborted");
      },
    };

    const result = await executeBashWithOperations("sleep 10", "/tmp", operations, {
      signal: controller.signal,
    });
    assert.equal(result.cancelled, true);
    assert.equal(result.exitCode, undefined);
  });

  test("streams chunks through onChunk callback", async () => {
    const chunks: string[] = [];
    const operations: BashOperations = {
      exec: async (_command, _cwd, options) => {
        options?.onData?.(Buffer.from("chunk-a"));
        options?.onData?.(Buffer.from("chunk-b"));
        return { exitCode: 0 };
      },
    };

    await executeBashWithOperations("printf ab", "/tmp", operations, {
      onChunk: (chunk) => chunks.push(chunk),
    });

    assert.deepEqual(chunks, ["chunk-a", "chunk-b"]);
  });
});

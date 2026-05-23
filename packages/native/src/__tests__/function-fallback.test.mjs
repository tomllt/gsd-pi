import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("xxhash and grep helpers fall back to JS when native addon is unavailable", () => {
  const script = `
    const { xxHash32, xxHash32Fallback } = require("./dist/xxhash");
    const { searchContent } = require("./dist/grep");
    const input = "the quick brown fox jumps over the lazy dog";
    const search = searchContent(Buffer.from("alpha\\nneedle-found-here\\ndelta"), {
      pattern: "needle-found-here",
    });
    process.stdout.write(JSON.stringify({
      hash: xxHash32(input, 0),
      fallback: xxHash32Fallback(input, 0),
      search,
    }));
  `;

  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: packageRoot,
    env: { ...process.env, GSD_NATIVE_DISABLE: "1" },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.hash, output.fallback);
  assert.equal(output.search.matchCount, 1);
  assert.equal(output.search.limitReached, false);
  assert.equal(output.search.matches[0].lineNumber, 2);
  assert.equal(output.search.matches[0].line, "needle-found-here");
});

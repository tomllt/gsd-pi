import test from "node:test";
import assert from "node:assert/strict";
import { relative, join } from "node:path";
import { tmpdir } from "node:os";

import { getProjectSessionsDir } from "../project-sessions.ts";

function assertInsideBase(base: string, path: string): void {
  const rel = relative(base, path);
  assert.ok(rel !== "", "path should resolve to a child of the sessions root");
  assert.ok(!rel.startsWith(".."), "path must not escape the sessions root");
  assert.ok(!rel.includes(".."), "encoded session directory must not contain traversal segments");
}

test("getProjectSessionsDir encodes an absolute cwd as one safe directory segment", () => {
  const base = join(tmpdir(), "gsd-project-sessions");

  assert.equal(
    getProjectSessionsDir("/tmp/current-project", base),
    join(base, "--tmp-current-project--"),
  );
});

test("getProjectSessionsDir keeps traversal-like cwd values under the sessions root", () => {
  const base = join(tmpdir(), "gsd-project-sessions");
  const result = getProjectSessionsDir("/tmp/project/../../outside:repo", base);

  assert.equal(result, join(base, "--outside-repo--"));
  assertInsideBase(base, result);
});

test("getProjectSessionsDir encodes Windows separators and drive delimiters", () => {
  const base = join(tmpdir(), "gsd-project-sessions");
  const result = getProjectSessionsDir("C:\\Users\\me\\repo", base);

  assert.equal(result, join(base, "--C--Users-me-repo--"));
  assertInsideBase(base, result);
});

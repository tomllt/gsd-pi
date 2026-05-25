// Project/App: gsd-pi
// File Purpose: Regression tests for project-root dirty snapshot fingerprints.

import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, ftruncateSync, openSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { captureRootDirtySnapshot } from "../root-write-leak-guard.ts";
import { cleanup, git, makeTempRepo } from "./test-utils.ts";

test("captureRootDirtySnapshot does not read dirty files larger than Node's Buffer limit", () => {
  const base = makeTempRepo("gsd-root-dirty-large-");
  try {
    const relPath = "large.bin";
    const absPath = join(base, relPath);

    writeFileSync(absPath, "tracked\n", "utf-8");
    git(base, "add", relPath);
    git(base, "commit", "-m", "track large fixture");

    const fd = openSync(absPath, "r+");
    try {
      ftruncateSync(fd, 2_200 * 1024 * 1024);
    } finally {
      closeSync(fd);
    }

    const size = statSync(absPath).size;
    assert.ok(size > 2 * 1024 * 1024 * 1024, "fixture must exceed Node's readFileSync Buffer limit");

    const snapshot = captureRootDirtySnapshot(base);
    const entry = snapshot.get(relPath);

    assert.equal(entry?.status, "M");
    assert.match(entry?.fingerprint ?? "", /^large:\d+:/);
  } finally {
    cleanup(base);
  }
});

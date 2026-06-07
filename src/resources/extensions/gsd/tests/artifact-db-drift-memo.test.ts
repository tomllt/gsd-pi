// Project/App: gsd-pi
// File Purpose: #442 Phase 1.6 — detectArtifactDbDrift is memoized per
// DriftContext so the three artifact/DB drift handlers share one
// milestone→slice→task walk per detection pass instead of recomputing it
// three times. Asserts external behavior: same ctx returns the same result
// (shared within a pass); a fresh ctx recomputes identical content (no
// cross-pass leakage).

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase, closeDatabase, insertMilestone, insertSlice } from "../gsd-db.ts";
import { detectArtifactDbDrift } from "../state-reconciliation/drift/artifact-db.ts";
import type { DriftContext } from "../state-reconciliation/types.ts";
import type { GSDState } from "../types.ts";

function stubState(): GSDState {
  return {
    activeMilestone: { id: "M001", title: "M" },
    activeSlice: null,
    activeTask: null,
    phase: "executing",
    recentDecisions: [],
    blockers: [],
    nextAction: "",
    registry: [],
    requirements: { active: 0, validated: 0, deferred: 0, outOfScope: 0, blocked: 0, total: 0 },
    progress: { milestones: { done: 0, total: 1 } },
  };
}

test("#442: detectArtifactDbDrift is memoized per DriftContext", (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-artifact-memo-"));
  const sliceDir = join(base, ".gsd", "milestones", "M001", "slices", "S01");
  mkdirSync(sliceDir, { recursive: true });
  t.after(() => {
    try { closeDatabase(); } catch { /* noop */ }
    rmSync(base, { recursive: true, force: true });
  });

  openDatabase(join(base, ".gsd", "gsd.db"));
  insertMilestone({ id: "M001", title: "M", status: "active" });
  insertSlice({ id: "S01", milestoneId: "M001", title: "Slice", status: "pending", risk: "low", depends: [], sequence: 1 });
  // A SUMMARY on disk while the slice is still pending = artifact/DB divergence.
  writeFileSync(join(sliceDir, "S01-SUMMARY.md"), "# S01 Summary\n");

  const state = stubState();

  const ctx1: DriftContext = { basePath: base, state };
  const first = detectArtifactDbDrift(state, ctx1);
  const firstAgain = detectArtifactDbDrift(state, ctx1);

  // Same ctx → cache hit → identical array reference (the 3 handlers in one
  // pass share this exact result).
  assert.strictEqual(firstAgain, first, "same ctx must return the memoized result");
  assert.ok(first.length > 0, "fixture should produce at least one drift record");

  // Fresh ctx → recomputed (distinct instance) but identical content.
  const ctx2: DriftContext = { basePath: base, state };
  const second = detectArtifactDbDrift(state, ctx2);
  assert.notStrictEqual(second, first, "a fresh ctx must recompute, not reuse the prior pass");
  assert.deepEqual(second, first, "recomputed result must be identical content");
});

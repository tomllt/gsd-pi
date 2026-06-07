// Project/App: gsd-pi
// File Purpose: Cover the getDebugCounters() snapshot getter added for the
// per-dispatch benchmark harness (issue #442, Phase 0.3). The harness itself
// (scripts/auto-dispatch-baseline.mjs) reads counters via this getter without
// disabling debug (which is what writeDebugSummary does).

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  enableDebug,
  disableDebug,
  debugCount,
  getDebugCounters,
} from '../debug-logger.ts';

function tmpGsd(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'gsd-baseline-harness-'));
  mkdirSync(join(tmp, '.gsd'), { recursive: true });
  return tmp;
}

test('getDebugCounters returns a live snapshot of the hot-path counters', () => {
  enableDebug(tmpGsd());

  debugCount('deriveStateCalls', 3);
  debugCount('parseRoadmapCalls');
  debugCount('parsePlanCalls', 2);
  debugCount('gitInvocations', 7);

  const snap = getDebugCounters();
  assert.strictEqual(snap.deriveStateCalls, 3);
  assert.strictEqual(snap.parseRoadmapCalls, 1);
  assert.strictEqual(snap.parsePlanCalls, 2);
  assert.strictEqual(snap.gitInvocations, 7);

  disableDebug();
});

test('getDebugCounters returns a copy — callers cannot mutate internal state', () => {
  enableDebug(tmpGsd());
  debugCount('gitInvocations', 5);

  const snap = getDebugCounters() as Record<string, number>;
  snap.gitInvocations = 999;

  assert.strictEqual(getDebugCounters().gitInvocations, 5, 'internal counter must be unaffected by mutating the snapshot');

  disableDebug();
});

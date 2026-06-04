/**
 * Behavioural regression test for #3580 — complete-slice verification gate.
 *
 * The gate must reject completion when the verification or UAT content
 * indicates a blocked or failed slice. Drives the real handler with
 * blocked-signal fixtures and asserts on the returned error. Replaces an
 * earlier test file that only string-matched the BLOCKED_SIGNALS regex
 * literal in the source (Refs #4826/#4831).
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  openDatabase,
  closeDatabase,
  insertMilestone,
  insertSlice,
  insertTask,
  setSliceSummaryMd,
} from '../gsd-db.ts';
import { handleCompleteSlice } from '../tools/complete-slice.ts';
import type { CompleteSliceParams } from '../types.ts';

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-blocked-gate-'));
  return path.join(dir, 'test.db');
}

function cleanupDb(dbPath: string): void {
  closeDatabase();
  try { fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }); } catch { /* */ }
}

function makeProject(): string {
  const basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-gate-proj-'));
  fs.mkdirSync(path.join(basePath, '.gsd', 'milestones', 'M001', 'slices', 'S01', 'tasks'), { recursive: true });
  fs.writeFileSync(
    path.join(basePath, '.gsd', 'milestones', 'M001', 'M001-ROADMAP.md'),
    `# M001\n\n## Slices\n- [ ] **S01: Test** \`risk:low\` \`depends:[]\`\n  - After this: works\n`,
  );
  return basePath;
}

function makeParams(overrides: Partial<CompleteSliceParams>): CompleteSliceParams {
  return {
    sliceId: 'S01',
    milestoneId: 'M001',
    sliceTitle: 'Test Slice',
    oneLiner: 'one liner',
    narrative: 'narrative',
    verification: 'all green',
    deviations: 'None.',
    knownLimitations: 'None.',
    followUps: 'None.',
    keyFiles: [],
    keyDecisions: [],
    patternsEstablished: [],
    observabilitySurfaces: [],
    provides: [],
    requirementsSurfaced: [],
    drillDownPaths: [],
    affects: [],
    requirementsAdvanced: [],
    requirementsValidated: [],
    requirementsInvalidated: [],
    filesModified: [],
    requires: [],
    uatContent: 'UAT body.',
    ...overrides,
  };
}

describe('complete-slice verification gate (#3580)', () => {
  let dbPath: string;
  let basePath: string;

  beforeEach(() => {
    dbPath = tempDbPath();
    openDatabase(dbPath);
    basePath = makeProject();
    insertMilestone({ id: 'M001' });
    insertSlice({ id: 'S01', milestoneId: 'M001' });
    insertTask({ id: 'T01', sliceId: 'S01', milestoneId: 'M001', status: 'complete', title: 'T1' });
  });

  afterEach(() => {
    cleanupDb(dbPath);
    try { fs.rmSync(basePath, { recursive: true, force: true }); } catch { /* */ }
  });

  test('rejects when verification text contains "verification failed"', async () => {
    const result = await handleCompleteSlice(
      makeParams({ verification: 'verification failed: the regression came back' }),
      basePath,
    );
    assert.ok('error' in result, 'expected handler to return an error');
    assert.match((result as { error: string }).error, /blocked|failed|do not complete/i);
  });

  test('rejects when uatContent contains "verification_result: failed"', async () => {
    const result = await handleCompleteSlice(
      makeParams({ uatContent: '## Result\nverification_result: failed\n' }),
      basePath,
    );
    assert.ok('error' in result, 'expected handler to return an error');
    assert.match((result as { error: string }).error, /blocked|failed|do not complete/i);
  });

  test('rejects when verification declares "status: blocked"', async () => {
    const result = await handleCompleteSlice(
      makeParams({ verification: 'status: blocked — db unavailable' }),
      basePath,
    );
    assert.ok('error' in result, 'expected handler to return an error');
    assert.match((result as { error: string }).error, /blocked|failed|do not complete/i);
  });

  test('rejects when uatContent says "slice is blocked"', async () => {
    const result = await handleCompleteSlice(
      makeParams({ uatContent: 'slice is blocked on upstream' }),
      basePath,
    );
    assert.ok('error' in result, 'expected handler to return an error');
    assert.match((result as { error: string }).error, /blocked|failed|do not complete/i);
  });

  test('rejects when verification says "cannot complete"', async () => {
    const result = await handleCompleteSlice(
      makeParams({ verification: 'cannot complete: requirements unmet' }),
      basePath,
    );
    assert.ok('error' in result, 'expected handler to return an error');
    assert.match((result as { error: string }).error, /blocked|failed|do not complete/i);
  });

  test('passes the gate when verification + uatContent are clean', async () => {
    // Sanity: the gate is not over-eager. Clean inputs reach the rest of
    // the handler. (This call may still fail downstream because we provide
    // a thin fixture; the only guarantee here is that the error — if any —
    // is NOT the blocked-signals error.)
    const result = await handleCompleteSlice(
      makeParams({ verification: 'all 8 sections pass', uatContent: 'green across the board' }),
      basePath,
    );
    if ('error' in result) {
      assert.doesNotMatch(
        result.error,
        /blocked\/failed state — do not complete/,
        `clean inputs should not be rejected by the BLOCKED_SIGNALS gate, got: ${result.error}`,
      );
    }
  });

  // ── Browser/web UAT classification gate (M001/S03 regression) ──────────
  const BROWSER_UAT_BODY = [
    '## UAT Type',
    '- UAT mode: artifact-driven',
    '',
    '## Smoke Test',
    '1. Open the page in a browser and perform add/edit/complete/delete once.',
  ].join('\n');

  test('rejects an artifact-driven UAT that drives a browser (open the page in a browser)', async () => {
    const result = await handleCompleteSlice(
      makeParams({ uatContent: BROWSER_UAT_BODY }),
      basePath,
    );
    assert.ok('error' in result, 'expected handler to reject a browser UAT mislabeled artifact-driven');
    assert.match((result as { error: string }).error, /requires browser verification/i);
  });

  test('allows a runtime-executable UAT that runs a browser test command (playwright)', async () => {
    // Bugbot regression: runtime-executable legitimately drives a browser via a
    // command captured by gsd_uat_exec — it must not be pushed to gsd-browser.
    const body = [
      '## UAT Type',
      '- UAT mode: runtime-executable',
      '',
      '## Test Cases',
      '1. Run `npx playwright test` and confirm a passing exit code; capture a screenshot artifact.',
      '2. Hit http://localhost:3000/health and assert a 200 response.',
    ].join('\n');
    const result = await handleCompleteSlice(
      makeParams({ uatContent: body }),
      basePath,
    );
    if ('error' in result) {
      assert.doesNotMatch(
        result.error,
        /artifact-driven|browser-capable|browser verification/i,
        `runtime-executable command UATs must not be gated, got: ${result.error}`,
      );
    }
  });

  test('allows an artifact-driven UAT that only disclaims browser coverage (no false positive)', async () => {
    // S01-style: genuinely artifact-driven persistence scaffolding that merely
    // mentions "cross-browser" / "browser-level" in a Not-Proven disclaimer.
    const body = [
      '## UAT Type',
      '- UAT mode: artifact-driven',
      '',
      '## Not Proven By This UAT',
      '- Interactive browser-level CRUD and real cross-browser localStorage behavior.',
    ].join('\n');
    const result = await handleCompleteSlice(
      makeParams({ uatContent: body }),
      basePath,
    );
    if ('error' in result) {
      assert.doesNotMatch(
        result.error,
        /requires browser verification/i,
        `disclaimer-only mention must not trip the browser gate, got: ${result.error}`,
      );
    }
  });

  test('allows an artifact-driven UAT whose "navigate" step targets a file, not a browser', async () => {
    // Bugbot regression: a bare "navigate to <file/API>" must not trip the gate
    // just because it contains the word "navigate".
    const body = [
      '## UAT Type',
      '- UAT mode: artifact-driven',
      '',
      '## Test Cases',
      '1. Navigate to the generated report file and confirm the schema section exists.',
    ].join('\n');
    const result = await handleCompleteSlice(
      makeParams({ uatContent: body }),
      basePath,
    );
    if ('error' in result) {
      assert.doesNotMatch(
        result.error,
        /requires browser verification/i,
        `non-web "navigate" must not trip the browser gate, got: ${result.error}`,
      );
    }
  });

  test('allows a browser UAT when it is declared browser-executable', async () => {
    const body = BROWSER_UAT_BODY.replace('artifact-driven', 'browser-executable');
    const result = await handleCompleteSlice(
      makeParams({ uatContent: body }),
      basePath,
    );
    if ('error' in result) {
      assert.doesNotMatch(
        result.error,
        /requires browser verification/i,
        `browser-executable UAT must pass the browser gate, got: ${result.error}`,
      );
    }
  });

  test('allows a browser UAT when it is declared mixed (mixed receives browser tools)', async () => {
    const body = BROWSER_UAT_BODY.replace('artifact-driven', 'mixed (artifact-driven + browser)');
    const result = await handleCompleteSlice(
      makeParams({ uatContent: body }),
      basePath,
    );
    if ('error' in result) {
      assert.doesNotMatch(
        result.error,
        /requires browser verification/i,
        `mixed UAT must pass the browser gate, got: ${result.error}`,
      );
    }
  });

  test('backfills prior verification narrative when verification is omitted on re-completion', async () => {
    // Seed full_summary_md with a prior verification narrative (simulates a
    // previous completion where the verification text was recorded).
    const priorVerification = 'All 12 API integration tests pass — zero regressions detected.';
    const priorSummary = [
      '---',
      'verification_result: passed',
      '---',
      '',
      '# S01: Test Slice',
      '',
      '## What Happened',
      '',
      'narrative goes here',
      '',
      '## Verification',
      '',
      priorVerification,
      '',
      '## Requirements Advanced',
      '',
    ].join('\n');
    setSliceSummaryMd('M001', 'S01', priorSummary, '');

    // Complete slice without providing verification — handler must backfill
    // from the existing summary rather than writing an empty section.
    const result = await handleCompleteSlice(
      makeParams({ verification: undefined }),
      basePath,
    );

    assert.ok(!('error' in result), `expected success, got: ${'error' in result ? (result as { error: string }).error : ''}`);

    const { summaryPath } = result as { summaryPath: string };
    const written = fs.readFileSync(summaryPath, 'utf8');
    assert.ok(
      written.includes(priorVerification),
      `prior verification narrative must be preserved when verification is omitted; got:\n${written}`,
    );
  });
});

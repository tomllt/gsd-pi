// Project/App: gsd-pi
// File Purpose: Verifies /gsd forensics scopes issue-filing tools for its queued turn.

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyForensicsToolScope,
  buildForensicsToolingSection,
  createForensicsToolScope,
  restoreForensicsToolScope,
} from "../forensics.ts";

function tool(name: string): { name: string } {
  return { name };
}

test("forensics adds registered filing tools for the queued turn and restores the prior tools", () => {
  const originalTools = ["read"];
  let activeTools = [...originalTools];
  const pi = {
    getActiveTools: () => [...activeTools],
    getAllTools: () => ["read", "bash", "write"].map(tool),
    setActiveTools: (tools: string[]) => {
      activeTools = [...tools];
    },
  };

  const scope = createForensicsToolScope(pi as any);

  assert.deepEqual(scope.savedTools, originalTools);
  assert.deepEqual(scope.activeToolsForTurn, ["read", "bash", "write"]);
  assert.deepEqual(scope.availableFilingTools, ["bash", "write"]);
  assert.deepEqual(scope.missingFilingTools, []);
  assert.equal(scope.toolsChanged, true);
  assert.deepEqual(activeTools, originalTools, "scope creation must not mutate active tools");

  applyForensicsToolScope(pi as any, scope);
  assert.deepEqual(activeTools, ["read", "bash", "write"]);

  const toolingSection = buildForensicsToolingSection(scope);
  assert.match(toolingSection, /`bash`: available/);
  assert.match(toolingSection, /`write`: available/);
  assert.match(toolingSection, /GitHub duplicate-check and issue-creation protocols/);

  restoreForensicsToolScope(pi as any, scope);
  assert.deepEqual(activeTools, originalTools);
});

test("forensics tooling guidance falls back when bash is not registered", () => {
  let activeTools = ["read"];
  const pi = {
    getActiveTools: () => [...activeTools],
    getAllTools: () => ["read", "write"].map(tool),
    setActiveTools: (tools: string[]) => {
      activeTools = [...tools];
    },
  };

  const scope = createForensicsToolScope(pi as any);

  assert.deepEqual(scope.availableFilingTools, ["write"]);
  assert.deepEqual(scope.missingFilingTools, ["bash"]);
  assert.deepEqual(scope.activeToolsForTurn, ["read", "write"]);

  const toolingSection = buildForensicsToolingSection(scope);
  assert.match(toolingSection, /`bash`: unavailable/);
  assert.match(toolingSection, /paste-once shell script fallback/);
});

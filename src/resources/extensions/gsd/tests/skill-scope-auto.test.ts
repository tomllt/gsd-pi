import test from "node:test";
import assert from "node:assert/strict";

import {
  applyUnitSkillVisibility,
  effectiveSkillNamesForUnit,
  unitHasSkillManifest,
} from "../skill-scope.ts";

test("unitHasSkillManifest: manifest unit types return true", () => {
  assert.equal(unitHasSkillManifest("research-milestone"), true);
  assert.equal(unitHasSkillManifest("plan-slice"), true);
});

test("unitHasSkillManifest: wildcard unit types return false", () => {
  assert.equal(unitHasSkillManifest("execute-task"), false);
  assert.equal(unitHasSkillManifest(undefined), false);
  assert.equal(unitHasSkillManifest("unknown-unit"), false);
});

test("applyUnitSkillVisibility: sets manifest names for scoped units", () => {
  let visible: string[] | undefined;
  applyUnitSkillVisibility({
    setVisibleSkills: (names) => {
      visible = names;
    },
  }, "research-milestone");

  assert.ok(Array.isArray(visible));
  assert.ok(visible!.includes("write-docs"));
  assert.ok(visible!.length < 15);
});

test("applyUnitSkillVisibility: restores full catalog for wildcard units", () => {
  let visible: string[] | undefined = ["stale"];
  applyUnitSkillVisibility({
    setVisibleSkills: (names) => {
      visible = names;
    },
  }, "execute-task");

  assert.equal(visible, undefined);
});

test("effectiveSkillNamesForUnit: filters installed names by manifest", () => {
  const installed = ["write-docs", "review", "frontend-design", "tdd"];
  const scoped = effectiveSkillNamesForUnit("research-milestone", installed);
  assert.ok(scoped.includes("write-docs"));
  assert.ok(!scoped.includes("review"));
  assert.ok(scoped.length < installed.length);
});

test("effectiveSkillNamesForUnit: pass-through for wildcard units", () => {
  const installed = ["write-docs", "review"];
  assert.deepEqual(effectiveSkillNamesForUnit("execute-task", installed), installed);
});

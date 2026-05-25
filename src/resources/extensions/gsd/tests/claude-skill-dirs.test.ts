/**
 * Tests for Claude Code skill directory support in getSkillSearchDirs().
 *
 * Verifies that ~/.claude/skills/ and .claude/skills/ are included in
 * the skill search path alongside GSD bundled skills, ~/.agents/skills/,
 * and .agents/skills/.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { homedir } from "node:os";
import { getSkillSearchDirs } from "../preferences-skills.ts";
import { gsdHome } from "../gsd-home.ts";

describe("getSkillSearchDirs — Claude Code directory support", () => {
  const cwd = "/tmp/test-project";

  test("includes ~/.gsd/agent/skills/ as bundled user-skill", () => {
    const dirs = getSkillSearchDirs(cwd);
    const gsd = dirs.find((d) => d.dir === join(gsdHome(), "agent", "skills"));
    assert.ok(gsd, "should include ~/.gsd/agent/skills/");
    assert.equal(gsd!.method, "user-skill");
  });

  test("includes ~/.agents/skills/ as user-skill", () => {
    const dirs = getSkillSearchDirs(cwd);
    const agents = dirs.find((d) => d.dir === join(homedir(), ".agents", "skills"));
    assert.ok(agents, "should include ~/.agents/skills/");
    assert.equal(agents!.method, "user-skill");
  });

  test("includes .agents/skills/ as project-skill", () => {
    const dirs = getSkillSearchDirs(cwd);
    const projectAgents = dirs.find((d) => d.dir === join(cwd, ".agents", "skills"));
    assert.ok(projectAgents, "should include .agents/skills/");
    assert.equal(projectAgents!.method, "project-skill");
  });

  test("includes ~/.claude/skills/ as user-skill", () => {
    const dirs = getSkillSearchDirs(cwd);
    const claude = dirs.find((d) => d.dir === join(homedir(), ".claude", "skills"));
    assert.ok(claude, "should include ~/.claude/skills/");
    assert.equal(claude!.method, "user-skill");
  });

  test("includes .claude/skills/ as project-skill", () => {
    const dirs = getSkillSearchDirs(cwd);
    const projectClaude = dirs.find((d) => d.dir === join(cwd, ".claude", "skills"));
    assert.ok(projectClaude, "should include .claude/skills/");
    assert.equal(projectClaude!.method, "project-skill");
  });

  test("~/.gsd/agent/skills/ appears before ecosystem and Claude dirs (priority order)", () => {
    const dirs = getSkillSearchDirs(cwd);
    const gsdIdx = dirs.findIndex((d) => d.dir === join(gsdHome(), "agent", "skills"));
    const agentsIdx = dirs.findIndex((d) => d.dir === join(homedir(), ".agents", "skills"));
    const claudeIdx = dirs.findIndex((d) => d.dir === join(homedir(), ".claude", "skills"));
    assert.ok(gsdIdx < agentsIdx, "~/.gsd/agent/skills/ should have higher priority than ~/.agents/skills/");
    assert.ok(agentsIdx < claudeIdx, "~/.agents/skills/ should have higher priority than ~/.claude/skills/");
  });
});

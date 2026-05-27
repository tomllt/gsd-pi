import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildRequirementsBacklogDiscussContext,
  buildRequirementsBacklogSummaryLines,
  countUnmappedActiveRequirements,
  formatCompletePhaseNextAction,
  isRequirementMappedToMilestone,
  isRequirementMappedToSlice,
  summarizeRequirementsCoverage,
} from "../requirements-backlog.ts";
import { generateRequirementsMd } from "../db-writer.ts";
import { buildIdleMenuSummary } from "../closeout-wizard.ts";
import { buildGsdHomeModel } from "../gsd-command-home.ts";
import {
  closeDatabase,
  insertMilestone,
  insertRequirement,
  openDatabase,
} from "../gsd-db.ts";
import type { GSDState, Requirement } from "../types.ts";

const sampleRequirements: Requirement[] = [
  {
    id: "R001",
    class: "functional",
    status: "active",
    description: "Mapped to slice",
    why: "test",
    source: "test",
    primary_owner: "M001/S01",
    supporting_slices: "",
    validation: "mapped",
    notes: "",
    full_content: "",
    superseded_by: null,
  },
  {
    id: "R002",
    class: "functional",
    status: "active",
    description: "Needs milestone owner",
    why: "test",
    source: "test",
    primary_owner: "none",
    supporting_slices: "",
    validation: "unmapped",
    notes: "",
    full_content: "",
    superseded_by: null,
  },
  {
    id: "R003",
    class: "functional",
    status: "active",
    description: "Provisional milestone owner",
    why: "test",
    source: "test",
    primary_owner: "M002/none yet",
    supporting_slices: "",
    validation: "unmapped",
    notes: "",
    full_content: "",
    superseded_by: null,
  },
  {
    id: "R010",
    class: "functional",
    status: "validated",
    description: "Done",
    why: "test",
    source: "test",
    primary_owner: "M001/S01",
    supporting_slices: "",
    validation: "validated",
    notes: "",
    full_content: "",
    superseded_by: null,
  },
];

test("requirements-backlog mapping helpers distinguish milestone vs slice ownership", () => {
  assert.equal(isRequirementMappedToMilestone("M001/S01"), true);
  assert.equal(isRequirementMappedToMilestone("M002/none yet"), true);
  assert.equal(isRequirementMappedToMilestone("none"), false);
  assert.equal(isRequirementMappedToSlice("M001/S01"), true);
  assert.equal(isRequirementMappedToSlice("M002/none yet"), false);
});

test("summarizeRequirementsCoverage counts active, mapped-to-slice, and unmapped active", () => {
  const coverage = summarizeRequirementsCoverage(sampleRequirements);
  assert.equal(coverage.active, 3);
  assert.equal(coverage.mappedToSlice, 1);
  assert.equal(coverage.unmappedActive, 1);
  assert.deepEqual(
    coverage.unmappedActiveRequirements.map((req) => req.id),
    ["R002"],
  );
});

test("buildRequirementsBacklogDiscussContext instructs milestone ownership updates", () => {
  openDatabase(":memory:");
  try {
    insertRequirement({
      id: "R002",
      class: "functional",
      status: "active",
      description: "Needs milestone owner",
      why: "test",
      source: "test",
      primary_owner: "",
      supporting_slices: "",
      validation: "unmapped",
      notes: "",
      full_content: "",
      superseded_by: null,
    });

    const context = buildRequirementsBacklogDiscussContext("M002");
    assert.match(context, /Requirements Backlog — Milestone Ownership/);
    assert.match(context, /R002/);
    assert.match(context, /gsd_requirement_update/);
    assert.match(context, /M002\/none yet/);
    assert.match(context, /artifact_type: "REQUIREMENTS"/);
  } finally {
    closeDatabase();
  }
});

test("buildRequirementsBacklogDiscussContext returns empty when backlog is clear", () => {
  openDatabase(":memory:");
  try {
    assert.equal(buildRequirementsBacklogDiscussContext("M002"), "");
  } finally {
    closeDatabase();
  }
});

test("formatCompletePhaseNextAction uses unmapped count only", () => {
  assert.equal(formatCompletePhaseNextAction(0), "All milestones complete.");
  assert.match(
    formatCompletePhaseNextAction(8),
    /8 active requirements in REQUIREMENTS.md have not been mapped to a milestone/,
  );
});

test("generateRequirementsMd writes accurate coverage summary counts", () => {
  const md = generateRequirementsMd(sampleRequirements);
  assert.match(md, /- Active requirements: 3/);
  assert.match(md, /- Mapped to slices: 1/);
  assert.match(md, /- Unmapped active requirements: 1/);
});

test("idle menu and /gsd home surface backlog summary when DB has unmapped active requirements", () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-req-backlog-"));
  try {
    openDatabase(":memory:");
    insertMilestone({ id: "M001", title: "First", status: "complete" });
    insertRequirement({
      id: "R001",
      class: "functional",
      status: "active",
      description: "Still active",
      why: "test",
      source: "test",
      primary_owner: "",
      supporting_slices: "",
      validation: "",
      notes: "",
      full_content: "",
      superseded_by: null,
    });

    const state: GSDState = {
      activeMilestone: null,
      activeSlice: null,
      activeTask: null,
      phase: "complete",
      recentDecisions: [],
      blockers: [],
      nextAction: formatCompletePhaseNextAction(1),
      registry: [{ id: "M001", title: "First", status: "complete" }],
      requirements: { active: 1, validated: 0, deferred: 0, outOfScope: 0, blocked: 0, total: 1 },
      progress: { milestones: { done: 1, total: 1 } },
      lastCompletedMilestone: { id: "M001", title: "First" },
    };

    const idleSummary = buildIdleMenuSummary(state, { strandedQuick: null, unmergedMilestones: [] });
    assert.match(idleSummary.join("\n"), /1 active requirement still need milestone ownership/);
    assert.match(idleSummary.join("\n"), /R001:/);

    const home = buildGsdHomeModel(state);
    assert.match(home.summary.join("\n"), /1 active requirement still need milestone ownership/);
    assert.equal(home.actions.find((action) => action.id === "review_requirements_backlog")?.enabled, true);
    assert.equal(home.actions.find((action) => action.id === "review_requirements_backlog")?.recommended, true);
    assert.equal(countUnmappedActiveRequirements(), 1);
    assert.deepEqual(
      buildRequirementsBacklogSummaryLines(1, [{ ...sampleRequirements[1], id: "R001" }]),
      [
        "1 active requirement still need milestone ownership — see REQUIREMENTS.md traceability table.",
        "  • R001: Needs milestone owner",
      ],
    );
  } finally {
    closeDatabase();
    rmSync(base, { recursive: true, force: true });
  }
});

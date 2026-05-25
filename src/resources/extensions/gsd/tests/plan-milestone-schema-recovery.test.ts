/**
 * Regression tests for gsd_plan_milestone schema confusion recovery.
 * Models call gsd_plan_milestone with { milestoneId, sliceId } only (gsd_plan_slice shape).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPlanMilestoneRecoverySteering,
  enrichPlanMilestoneValidationError,
  isPlanMilestoneSliceIdConfusion,
  isPlanMilestoneToolName,
} from "../bootstrap/plan-milestone-schema-recovery.js";

describe("plan-milestone schema recovery", () => {
  test("isPlanMilestoneToolName recognizes canonical and alias names", () => {
    assert.equal(isPlanMilestoneToolName("gsd_plan_milestone"), true);
    assert.equal(isPlanMilestoneToolName("gsd_milestone_plan"), true);
    assert.equal(isPlanMilestoneToolName("gsd_plan_slice"), false);
  });

  test("isPlanMilestoneSliceIdConfusion detects slice-only payload", () => {
    assert.equal(
      isPlanMilestoneSliceIdConfusion({ milestoneId: "M001", sliceId: "S01" }),
      true,
    );
    assert.equal(
      isPlanMilestoneSliceIdConfusion({
        milestoneId: "M001",
        title: "Title",
        vision: "Vision",
        slices: [{ sliceId: "S01" }],
      }),
      false,
    );
    assert.equal(
      isPlanMilestoneSliceIdConfusion({ milestoneId: "M001", sliceId: "S01", title: "T" }),
      false,
    );
  });

  test("enrichPlanMilestoneValidationError documents required fields and minimal JSON", () => {
    const enriched = enrichPlanMilestoneValidationError(
      'Validation failed for tool "gsd_plan_milestone":\n  - title: must have required property',
      { milestoneId: "M001", sliceId: "S01" },
    );
    assert.match(enriched, /gsd_plan_slice/);
    assert.match(enriched, /title, vision, slices/);
    assert.match(enriched, /"milestoneId": "M001"/);
    assert.match(enriched, /"slices":/);
  });

  test("buildPlanMilestoneRecoverySteering references milestone and full payload", () => {
    const steering = buildPlanMilestoneRecoverySteering("M002");
    assert.match(steering, /M002/);
    assert.match(steering, /title, vision/);
    assert.match(steering, /gsd_plan_slice/);
  });
});

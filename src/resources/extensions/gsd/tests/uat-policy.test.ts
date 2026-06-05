import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyUatContent,
  getDeclaredUatType,
  getUatBrowserToolSupportError,
  hasUatBrowserToolSurface,
  isPartialEligibleUatType,
  resolveEffectiveUatType,
  shouldDispatchUatForContent,
  shouldEscalateArtifactUatToBrowser,
  uatTypeIncludesBrowser,
  validateUatModePolicy,
} from "../uat-policy.ts";

describe("uat-policy", () => {
  it("defaults missing UAT mode to artifact-driven", () => {
    assert.equal(getDeclaredUatType("# UAT\n\nCheck generated files."), "artifact-driven");
  });

  it("escalates artifact-driven UAT to browser-executable when the spec requires browser work", () => {
    const content = [
      "## UAT Type",
      "- UAT mode: artifact-driven",
      "",
      "## Test",
      "Open the page in a browser and verify the submit button is visible.",
    ].join("\n");

    assert.equal(shouldEscalateArtifactUatToBrowser(content), true);
    assert.equal(resolveEffectiveUatType(content), "browser-executable");
    assert.equal(shouldDispatchUatForContent(content, undefined), true);
    assert.deepEqual(classifyUatContent(content), {
      declaredType: "artifact-driven",
      effectiveType: "browser-executable",
      browserRequired: true,
      shouldDispatchByDefault: true,
    });
  });

  it("does not escalate disclaimer-only browser mentions", () => {
    const content = [
      "## UAT Type",
      "- UAT mode: artifact-driven",
      "",
      "## Not Proven By This UAT",
      "- No live browser session was run in this artifact check.",
    ].join("\n");

    assert.equal(shouldEscalateArtifactUatToBrowser(content), false);
    assert.equal(resolveEffectiveUatType(content), "artifact-driven");
    assert.equal(shouldDispatchUatForContent(content, undefined), false);
  });

  it("centralizes which UAT modes receive browser tools", () => {
    for (const uatType of ["browser-executable", "live-runtime", "mixed", "human-experience"] as const) {
      assert.equal(uatTypeIncludesBrowser(uatType), true, `${uatType} should include browser tools`);
    }

    for (const uatType of ["artifact-driven", "runtime-executable"] as const) {
      assert.equal(uatTypeIncludesBrowser(uatType), false, `${uatType} should not include browser tools`);
    }
  });

  it("detects direct and MCP-shaped browser tool surfaces", () => {
    assert.equal(hasUatBrowserToolSurface(["read", "browser_navigate"]), true);
    assert.equal(hasUatBrowserToolSurface(["read", "mcp__gsd-browser__browser_navigate"]), true);
    assert.equal(hasUatBrowserToolSurface(["read", "gsd_uat_exec"]), false);
    assert.equal(hasUatBrowserToolSurface(undefined), false);
  });

  it("reports missing browser tools only for browser-backed UAT with a known tool snapshot", () => {
    assert.equal(
      getUatBrowserToolSupportError({
        uatType: "artifact-driven",
        activeTools: ["read", "gsd_uat_exec"],
        milestoneId: "M001",
        sliceId: "S01",
      }),
      null,
    );
    assert.equal(
      getUatBrowserToolSupportError({
        uatType: "browser-executable",
        activeTools: undefined,
        milestoneId: "M001",
        sliceId: "S01",
      }),
      null,
    );

    const error = getUatBrowserToolSupportError({
      uatType: "browser-executable",
      activeTools: ["read", "gsd_uat_exec"],
      milestoneId: "M001",
      sliceId: "S01",
    });
    assert.match(error ?? "", /Cannot dispatch browser-backed run-uat for M001\/S01/);
  });

  it("centralizes partial verdict eligibility", () => {
    assert.equal(isPartialEligibleUatType("mixed"), true);
    assert.equal(isPartialEligibleUatType("human-experience"), true);
    assert.equal(isPartialEligibleUatType("live-runtime"), true);
    assert.equal(isPartialEligibleUatType("artifact-driven"), false);
    assert.equal(isPartialEligibleUatType("browser-executable"), false);
    assert.equal(isPartialEligibleUatType("runtime-executable"), false);
  });

  it("requires runtime evidence for runtime-executable UAT", () => {
    assert.equal(
      validateUatModePolicy({
        uatType: "runtime-executable",
        verdict: "PASS",
        checks: [{ mode: "artifact", result: "PASS" }],
      }),
      "runtime-executable UAT requires runtime evidence",
    );

    assert.equal(
      validateUatModePolicy({
        uatType: "runtime-executable",
        verdict: "PASS",
        checks: [{ mode: "runtime", result: "PASS" }],
      }),
      null,
    );
  });

  it("requires browser evidence for browser-executable UAT", () => {
    assert.equal(
      validateUatModePolicy({
        uatType: "browser-executable",
        verdict: "PASS",
        checks: [{ mode: "runtime", result: "PASS" }],
      }),
      "browser-executable UAT requires browser evidence",
    );

    assert.equal(
      validateUatModePolicy({
        uatType: "browser-executable",
        verdict: "PASS",
        checks: [{ mode: "browser", result: "PASS" }],
      }),
      null,
    );
  });

  it("allows live-runtime evidence through either runtime or browser checks", () => {
    assert.equal(
      validateUatModePolicy({
        uatType: "live-runtime",
        verdict: "PASS",
        checks: [{ mode: "artifact", result: "PASS" }],
      }),
      "live-runtime UAT requires runtime or browser evidence",
    );

    assert.equal(
      validateUatModePolicy({
        uatType: "live-runtime",
        verdict: "PASS",
        checks: [{ mode: "browser", result: "PASS" }],
      }),
      null,
    );
  });
});

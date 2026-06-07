// Project/App: Open GSD
// File Purpose: Regression tests for the CI builder image pipeline workflow.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import YAML from "yaml";

const workflow = YAML.parse(readFileSync(".github/workflows/pipeline.yml", "utf8"));
const job = workflow.jobs["update-builder"];

test("pipeline workflow can be manually dispatched to bootstrap the builder image", () => {
  assert.deepEqual(workflow.on.workflow_dispatch, {});
  assert.match(job.if, /github\.event_name == 'workflow_dispatch'/);
});

test("manual pipeline dispatch checks out main and forces a builder image push", () => {
  const checkout = job.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  const check = job.steps.find((step) => step.id === "check");

  assert.match(checkout.with.ref, /github\.event_name == 'workflow_dispatch'/);
  assert.match(checkout.with.ref, /'main'/);
  assert.match(check.run, /GITHUB_EVENT_NAME" = "workflow_dispatch"/);
  assert.match(check.run, /changed=true/);
});

test("automatic pipeline runs still require successful CI on main", () => {
  assert.match(job.if, /workflow_run\.conclusion == 'success'/);
  assert.match(job.if, /workflow_run\.head_branch == 'main'/);
});

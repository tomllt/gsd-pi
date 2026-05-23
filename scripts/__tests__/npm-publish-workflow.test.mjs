// Project/App: gsd-pi
// File Purpose: Regression tests for npm publish workflow channel policy.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import YAML from "yaml";

const workflow = YAML.parse(
  readFileSync(".github/workflows/npm-publish.yml", "utf8"),
);

test("npm publish exposes only supported npm channels", () => {
  const channel = workflow.on.workflow_dispatch.inputs.channel;

  assert.equal(channel.required, true);
  assert.equal(channel.default, "dev");
  assert.deepEqual(channel.options, ["dev", "next", "latest"]);
});

test("prerelease publish gates through the selected GitHub Environment", () => {
  assert.equal(
    workflow.jobs["prerelease-publish"].environment,
    "${{ github.event.inputs.channel }}",
  );
});

test("production publish keeps the prod approval gate", () => {
  assert.equal(
    workflow.jobs["prod-release"].if,
    "${{ github.event.inputs.channel == 'latest' }}",
  );
  assert.equal(workflow.jobs["prod-release"].environment, "prod");
});

test("prerelease publish preserves channel-specific default refs", () => {
  const checkout = workflow.jobs["prerelease-publish"].steps.find(
    (step) => step.uses === "actions/checkout@v6",
  );

  assert.equal(workflow.on.workflow_dispatch.inputs.ref.default, "");
  assert.equal(checkout.with.token, "${{ github.token }}");
  assert.match(checkout.with.ref, /github\.event\.inputs\.channel == 'next'/);
  assert.match(checkout.with.ref, /'next'/);
  assert.match(checkout.with.ref, /'main'/);
});

test("npm publish supports token auth fallback for prerelease", () => {
  const input = workflow.on.workflow_dispatch.inputs.publish_auth;

  assert.equal(input.default, "trusted");
  assert.deepEqual(input.options, ["trusted", "token"]);

  const setupNode = workflow.jobs["prerelease-publish"].steps.find(
    (step) => step.uses === "actions/setup-node@v6",
  );
  assert.equal(
    setupNode.env.NODE_AUTH_TOKEN,
    "${{ github.event.inputs.publish_auth == 'token' && secrets.NPM_TOKEN || '' }}",
  );
});

test("main package publish verifies native engine packages first", () => {
  const prereleaseSteps = workflow.jobs["prerelease-publish"].steps;
  const prereleaseVerify = prereleaseSteps.find(
    (step) => step.name === "Verify native platform packages exist",
  );
  const prereleasePublishIndex = prereleaseSteps.findIndex(
    (step) => step.name === "Publish @${{ github.event.inputs.channel }}",
  );
  const prereleaseVerifyIndex = prereleaseSteps.indexOf(prereleaseVerify);

  assert.ok(prereleaseVerify, "prerelease publish must verify native packages");
  assert.match(prereleaseVerify.run, /npm run verify:native-platform-packages -- --any-version/);
  assert.ok(prereleaseVerifyIndex > -1 && prereleaseVerifyIndex < prereleasePublishIndex);

  const prodSteps = workflow.jobs["prod-release"].steps;
  const prodVerify = prodSteps.find(
    (step) => step.name === "Verify native platform packages for release version",
  );
  const prodPublishIndex = prodSteps.findIndex(
    (step) => step.name === "Publish release to npm @latest",
  );
  const prodVerifyIndex = prodSteps.indexOf(prodVerify);

  assert.ok(prodVerify, "production publish must verify native packages");
  assert.match(prodVerify.run, /npm run verify:native-platform-packages/);
  assert.ok(prodVerifyIndex > -1 && prodVerifyIndex < prodPublishIndex);
});

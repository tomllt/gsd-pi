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
  assert.deepEqual(workflow.jobs["prod-release"].needs, [
    "prod-release-plan",
    "prod-native-build",
  ]);
  assert.equal(workflow.jobs["prod-release"].environment, "prod");
});

test("prerelease publish preserves channel-specific default refs", () => {
  const checkout = workflow.jobs["prerelease-publish"].steps.find(
    (step) => step.uses?.startsWith("actions/checkout@"),
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
    (step) => step.uses?.startsWith("actions/setup-node@"),
  );
  assert.equal(
    setupNode.env.NODE_AUTH_TOKEN,
    "${{ github.event.inputs.publish_auth == 'token' && secrets.NPM_TOKEN || '' }}",
  );
});

test("publish jobs use GitHub-hosted runners for npm provenance", () => {
  assert.equal(workflow.jobs["prerelease-publish"]["runs-on"], "ubuntu-latest");
  assert.equal(workflow.jobs["prod-release"]["runs-on"], "ubuntu-latest");
});

test("production publish plans the release and builds native artifacts in the same workflow", () => {
  const plan = workflow.jobs["prod-release-plan"];
  const nativeBuild = workflow.jobs["prod-native-build"];

  assert.ok(plan, "production publish must plan the release version");
  assert.equal(plan.if, "${{ github.event.inputs.channel == 'latest' }}");
  assert.equal(plan.outputs.version, "${{ steps.release.outputs.version }}");
  assert.equal(plan.outputs.source_sha, "${{ steps.release.outputs.source_sha }}");
  assert.ok(
    plan.steps.some((step) => step.uses?.startsWith("actions/upload-artifact@")),
    "release metadata must be passed to the gated publish job",
  );

  assert.ok(nativeBuild, "production publish must build native binaries");
  assert.equal(nativeBuild.needs, "prod-release-plan");
  assert.deepEqual(
    nativeBuild.strategy.matrix.include.map((entry) => entry.platform).sort(),
    [
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64-gnu",
      "linux-x64-gnu",
      "win32-x64-msvc",
    ],
  );
  assert.ok(
    nativeBuild.steps.some((step) => step.uses?.startsWith("actions/upload-artifact@")),
    "native artifacts must be uploaded for the production release job",
  );
});

test("npm publish opts into Node 24 actions runtime and quiet npm install noise", () => {
  assert.equal(workflow.env.FORCE_JAVASCRIPT_ACTIONS_TO_NODE24, "true");
  assert.equal(workflow.env.NPM_CONFIG_AUDIT, "false");
  assert.equal(workflow.env.NPM_CONFIG_FUND, "false");
  assert.equal(workflow.env.NPM_CONFIG_LOGLEVEL, "error");
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
  assert.match(prereleaseVerify.run, /npm run verify:native-platform-packages/);
  assert.doesNotMatch(prereleaseVerify.run, /--any-version/);
  assert.ok(prereleaseVerifyIndex > -1 && prereleaseVerifyIndex < prereleasePublishIndex);

  const prodSteps = workflow.jobs["prod-release"].steps;
  const prodNativePublish = prodSteps.find(
    (step) => step.name === "Publish native platform packages for release version",
  );
  const prodVerify = prodSteps.find(
    (step) => step.name === "Verify native platform packages for release version",
  );
  const prodPublishIndex = prodSteps.findIndex(
    (step) => step.name === "Publish release to npm @latest",
  );
  const prodNativePublishIndex = prodSteps.indexOf(prodNativePublish);
  const prodVerifyIndex = prodSteps.indexOf(prodVerify);

  assert.ok(prodNativePublish, "production publish must publish native packages");
  assert.match(prodNativePublish.run, /publish-engine-packages\.sh/);
  assert.equal(
    prodNativePublish.env.ENGINE_VERSION,
    "${{ needs.prod-release-plan.outputs.version }}",
  );
  assert.ok(prodVerify, "production publish must verify native packages");
  assert.match(prodVerify.run, /npm run verify:native-platform-packages/);
  assert.ok(
    prodNativePublishIndex > -1 && prodNativePublishIndex < prodVerifyIndex,
  );
  assert.ok(prodVerifyIndex > -1 && prodVerifyIndex < prodPublishIndex);
});

test("main package publish validates tarball before publishing", () => {
  const prereleaseSteps = workflow.jobs["prerelease-publish"].steps;
  const prereleaseValidate = prereleaseSteps.find(
    (step) => step.name === "Validate package is installable",
  );
  const prereleasePublishIndex = prereleaseSteps.findIndex(
    (step) => step.name === "Publish @${{ github.event.inputs.channel }}",
  );

  assert.ok(prereleaseValidate, "prerelease publish must run validate-pack");
  assert.match(prereleaseValidate.run, /pnpm run validate-pack/);
  assert.ok(prereleaseSteps.indexOf(prereleaseValidate) < prereleasePublishIndex);

  const prodSteps = workflow.jobs["prod-release"].steps;
  const prodValidate = prodSteps.find(
    (step) => step.name === "Validate package is installable",
  );
  const prodPublishIndex = prodSteps.findIndex(
    (step) => step.name === "Publish release to npm @latest",
  );

  assert.ok(prodValidate, "production publish must run validate-pack");
  assert.match(prodValidate.run, /pnpm run validate-pack/);
  assert.ok(prodSteps.indexOf(prodValidate) < prodPublishIndex);
});

test("production release publishes workspace packages and verifies ALL packages before cutting the GitHub release", () => {
  const steps = workflow.jobs["prod-release"].steps;
  const idx = (name) => steps.findIndex((s) => s.name === name);

  const workspacePublish = idx("Publish workspace packages to npm");
  const mainPublish = idx("Publish release to npm @latest");
  const verifyAll = idx("Verify all required packages are published on npm");
  const pushTag = idx("Push release commit and tag");
  const ghRelease = idx("Create GitHub Release");

  // Workspace packages publish before the main package.
  assert.ok(workspacePublish > -1, "prod-release must publish workspace packages");
  assert.ok(workspacePublish < mainPublish, "workspace packages must publish before the main package");
  assert.match(steps[workspacePublish].run, /publish-workspace-packages\.sh/);
  assert.match(steps[workspacePublish].run, /prepack-resolve-workspace\.cjs/);

  // The full verification gate runs AFTER all publishing and BEFORE the release is cut.
  assert.ok(verifyAll > -1, "prod-release must verify all required packages on npm");
  assert.match(steps[verifyAll].run, /verify-npm-release\.mjs/);
  assert.ok(verifyAll > mainPublish, "verify must run after the main package is published");
  assert.ok(verifyAll < pushTag, "verify must run before the release tag is pushed");
  assert.ok(verifyAll < ghRelease, "verify must run before the GitHub release is created");
});

test("main package publish uses explicit prepack and disables npm lifecycle reruns", () => {
  const prereleasePublish = workflow.jobs["prerelease-publish"].steps.find(
    (step) => step.name === "Publish @${{ github.event.inputs.channel }}",
  );
  assert.match(prereleasePublish.run, /prepack-resolve-workspace\.cjs/);
  assert.match(prereleasePublish.run, /postpack-restore-workspace\.cjs/);
  assert.match(prereleasePublish.run, /npm publish --ignore-scripts --tag "\$\{CHANNEL\}"/);

  const prodPublish = workflow.jobs["prod-release"].steps.find(
    (step) => step.name === "Publish release to npm @latest",
  );
  assert.match(prodPublish.run, /prepack-resolve-workspace\.cjs/);
  assert.match(prodPublish.run, /postpack-restore-workspace\.cjs/);
  assert.match(prodPublish.run, /npm publish --ignore-scripts --tag latest/);
});

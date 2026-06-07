// Project/App: gsd-pi
// File Purpose: Regression tests for release follow-up comments on open issues.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import YAML from "yaml";

import {
  RELEASE_UPGRADE_LABEL,
  buildReleaseUpgradeComment,
  hasReleaseComment,
  issueHasLabel,
  listIssueComments,
  listOpenIssues,
  postReleaseUpgradeComments,
  releaseMarker,
  resolveRelease,
} from "../release-issue-upgrade-comments.mjs";

test("buildReleaseUpgradeComment asks reporters to upgrade and retry", () => {
  const comment = buildReleaseUpgradeComment(
    "v1.2.3",
    "https://github.com/open-gsd/gsd-pi/releases/tag/v1.2.3",
  );

  assert.ok(comment.includes(releaseMarker("v1.2.3")));
  assert.match(comment, /npm install -g @opengsd\/gsd-pi@latest/);
  assert.match(comment, /re-run your reproduction steps/);
  assert.match(comment, /If this still happens on \*\*v1\.2\.3\*\*/);
});

test("hasReleaseComment detects the per-release marker", () => {
  assert.equal(
    hasReleaseComment([{ body: `${releaseMarker("v1.2.3")}\nposted` }], "v1.2.3"),
    true,
  );
  assert.equal(hasReleaseComment([{ body: "ordinary comment" }], "v1.2.3"), false);
});

test("issueHasLabel detects string and object labels", () => {
  assert.equal(issueHasLabel({ labels: [RELEASE_UPGRADE_LABEL] }, RELEASE_UPGRADE_LABEL), true);
  assert.equal(
    issueHasLabel({ labels: [{ name: RELEASE_UPGRADE_LABEL }] }, RELEASE_UPGRADE_LABEL),
    true,
  );
  assert.equal(issueHasLabel({ labels: [{ name: "needs-info" }] }, RELEASE_UPGRADE_LABEL), false);
});

test("listOpenIssues paginates by raw page size and filters pull requests", async () => {
  const calls = [];
  const firstPage = [
    ...Array.from({ length: 99 }, (_, index) => ({ number: index + 1 })),
    { number: 1000, pull_request: {} },
  ];
  const githubJson = async (path) => {
    calls.push(path);
    return /page=1\b/.test(path) ? firstPage : [{ number: 100 }];
  };

  const issues = await listOpenIssues(githubJson, "open-gsd", "gsd-pi");

  assert.equal(issues.length, 100);
  assert.equal(issues.some((issue) => issue.pull_request), false);
  assert.equal(calls.length, 2);
});

test("listIssueComments paginates so duplicate markers are found on later pages", async () => {
  const calls = [];
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    body: `comment ${index}`,
  }));
  const githubJson = async (path) => {
    calls.push(path);
    return /page=1\b/.test(path) ? firstPage : [{ body: releaseMarker("v1.2.3") }];
  };

  const comments = await listIssueComments(githubJson, "open-gsd", "gsd-pi", 42);

  assert.equal(hasReleaseComment(comments, "v1.2.3"), true);
  assert.equal(calls.length, 2);
});

test("postReleaseUpgradeComments tags issues and skips duplicate comments", async () => {
  const comments = [];
  const labels = [];
  const githubJson = async (path, options = {}) => {
    if (path === "/repos/open-gsd/gsd-pi/issues?state=open&per_page=100&page=1") {
      return [
        { number: 1, labels: [] },
        { number: 2, labels: [] },
        { number: 3, pull_request: {} },
        { number: 4, labels: [{ name: RELEASE_UPGRADE_LABEL }] },
      ];
    }
    if (path === "/repos/open-gsd/gsd-pi/issues/1/comments?per_page=100&page=1") {
      return [{ body: releaseMarker("v1.2.3") }];
    }
    if (path === "/repos/open-gsd/gsd-pi/issues/2/comments?per_page=100&page=1") {
      return [];
    }
    if (path === "/repos/open-gsd/gsd-pi/issues/4/comments?per_page=100&page=1") {
      return [];
    }
    if (path === "/repos/open-gsd/gsd-pi/issues/2/comments" && options.method === "POST") {
      comments.push(JSON.parse(options.body));
      return { id: 123 };
    }
    if (path === "/repos/open-gsd/gsd-pi/issues/4/comments" && options.method === "POST") {
      comments.push(JSON.parse(options.body));
      return { id: 124 };
    }
    if (path.endsWith("/labels") && options.method === "POST") {
      labels.push({ path, body: JSON.parse(options.body) });
      return [{ name: RELEASE_UPGRADE_LABEL }];
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const result = await postReleaseUpgradeComments({
    githubJsonFn: githubJson,
    owner: "open-gsd",
    repo: "gsd-pi",
    releaseTag: "v1.2.3",
  });

  assert.deepEqual(result, { totalIssues: 3, posted: 2, skipped: 1, labeled: 2 });
  assert.equal(comments.length, 2);
  assert.equal(labels.length, 2);
  assert.deepEqual(
    labels.map((request) => request.body.labels),
    [[RELEASE_UPGRADE_LABEL], [RELEASE_UPGRADE_LABEL]],
  );
  assert.match(comments[0].body, /A new GSD release is available/);
});

test("resolveRelease prefers the release event payload when it matches", async () => {
  const release = await resolveRelease(
    async () => {
      throw new Error("API should not be called");
    },
    "open-gsd",
    "gsd-pi",
    { release: { tag_name: "v1.2.3", html_url: "https://example.test" } },
    "v1.2.3",
  );

  assert.equal(release.tag_name, "v1.2.3");
});

test("release issue upgrade workflow triggers on published releases", () => {
  const workflow = YAML.parse(
    readFileSync(".github/workflows/release-issue-upgrade-comments.yml", "utf8"),
  );
  const job = workflow.jobs["post-upgrade-comments"];

  assert.deepEqual(workflow.on.release.types, ["published"]);
  assert.equal(workflow.permissions.issues, "write");
  assert.equal(job["runs-on"], "blacksmith-4vcpu-ubuntu-2404");
  assert.ok(
    job.steps.some((step) => step.run === "node scripts/release-issue-upgrade-comments.mjs"),
  );
});

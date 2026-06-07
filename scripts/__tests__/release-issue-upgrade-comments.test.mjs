// Project/App: gsd-pi
// File Purpose: Regression tests for release follow-up comments on open issues.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import YAML from "yaml";

import {
  buildReleaseUpgradeComment,
  hasReleaseComment,
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

test("postReleaseUpgradeComments skips issues already commented for the release", async () => {
  const posts = [];
  const githubJson = async (path, options = {}) => {
    if (path === "/repos/open-gsd/gsd-pi/issues?state=open&per_page=100&page=1") {
      return [{ number: 1 }, { number: 2 }, { number: 3, pull_request: {} }];
    }
    if (path === "/repos/open-gsd/gsd-pi/issues/1/comments?per_page=100&page=1") {
      return [{ body: releaseMarker("v1.2.3") }];
    }
    if (path === "/repos/open-gsd/gsd-pi/issues/2/comments?per_page=100&page=1") {
      return [];
    }
    if (path === "/repos/open-gsd/gsd-pi/issues/2/comments" && options.method === "POST") {
      posts.push(JSON.parse(options.body));
      return { id: 123 };
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const result = await postReleaseUpgradeComments({
    githubJsonFn: githubJson,
    owner: "open-gsd",
    repo: "gsd-pi",
    releaseTag: "v1.2.3",
  });

  assert.deepEqual(result, { totalIssues: 2, posted: 1, skipped: 1 });
  assert.equal(posts.length, 1);
  assert.match(posts[0].body, /A new GSD release is available/);
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

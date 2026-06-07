#!/usr/bin/env node
// Project/App: gsd-pi
// File Purpose: Prompt open issue reporters to retry after a new stable release.

import { readFileSync } from "node:fs";

export const RELEASE_UPGRADE_MARKER_PREFIX = "<!-- gsd-release-upgrade-check:";
export const RELEASE_UPGRADE_LABEL = "needs-upgrade";

export function releaseMarker(releaseTag) {
  return `${RELEASE_UPGRADE_MARKER_PREFIX}${encodeURIComponent(releaseTag)} -->`;
}

export function hasReleaseComment(comments, releaseTag) {
  const marker = releaseMarker(releaseTag);
  return comments.some((comment) => String(comment.body || "").includes(marker));
}

export function issueHasLabel(issue, label) {
  const labels = Array.isArray(issue.labels) ? issue.labels : [];

  return labels.some((entry) => {
    const name = typeof entry === "string" ? entry : entry?.name;
    return name === label;
  });
}

export function displayReleaseTag(releaseTag) {
  return /^v/i.test(releaseTag) ? releaseTag : `v${releaseTag}`;
}

export function buildReleaseUpgradeComment(releaseTag, releaseUrl = "") {
  const displayTag = displayReleaseTag(releaseTag);
  const releaseLink = releaseUrl ? ` [${displayTag}](${releaseUrl})` : ` ${displayTag}`;

  return [
    releaseMarker(releaseTag),
    `A new GSD release is available:${releaseLink}.`,
    "",
    "Please upgrade to the latest version and re-run your reproduction steps:",
    "",
    "```bash",
    "npm install -g @opengsd/gsd-pi@latest",
    "gsd --version",
    "```",
    "",
    `If this still happens on **${displayTag}** or newer, please reply with your current version and any updated logs or reproduction details.`,
    "",
    "If the release fixed it, a quick note here helps us close this out.",
    "",
    "---",
    "*This is an automated release follow-up.*",
  ].join("\n");
}

export function parseRepository(repository) {
  const [owner, repo] = String(repository || "").split("/");
  if (!owner || !repo) {
    throw new Error(`GITHUB_REPOSITORY must be owner/repo, got: ${repository || "<empty>"}`);
  }
  return { owner, repo };
}

export async function listOpenIssues(githubJsonFn, owner, repo) {
  const perPage = 100;
  const issues = [];

  for (let page = 1; ; page += 1) {
    const pageItems = await githubJsonFn(
      `/repos/${owner}/${repo}/issues?state=open&per_page=${perPage}&page=${page}`,
    );
    issues.push(...pageItems.filter((issue) => !issue.pull_request));
    if (pageItems.length < perPage) break;
  }

  return issues;
}

export async function listIssueComments(githubJsonFn, owner, repo, issueNumber) {
  const perPage = 100;
  const comments = [];

  for (let page = 1; ; page += 1) {
    const pageItems = await githubJsonFn(
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=${perPage}&page=${page}`,
    );
    comments.push(...pageItems);
    if (pageItems.length < perPage) break;
  }

  return comments;
}

export async function resolveRelease(githubJsonFn, owner, repo, event, releaseTag) {
  const eventRelease = event?.release;
  if (eventRelease?.tag_name && (!releaseTag || releaseTag === eventRelease.tag_name)) {
    return eventRelease;
  }

  if (releaseTag) {
    return githubJsonFn(`/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(releaseTag)}`);
  }

  return githubJsonFn(`/repos/${owner}/${repo}/releases/latest`);
}

export async function postReleaseUpgradeComments({
  githubJsonFn,
  owner,
  repo,
  releaseTag,
  releaseUrl = "",
}) {
  const issues = await listOpenIssues(githubJsonFn, owner, repo);
  let posted = 0;
  let skipped = 0;
  let labeled = 0;

  for (const issue of issues) {
    const comments = await listIssueComments(githubJsonFn, owner, repo, issue.number);
    if (hasReleaseComment(comments, releaseTag)) {
      skipped += 1;
    } else {
      await githubJsonFn(`/repos/${owner}/${repo}/issues/${issue.number}/comments`, {
        method: "POST",
        body: JSON.stringify({
          body: buildReleaseUpgradeComment(releaseTag, releaseUrl),
        }),
      });
      posted += 1;
    }

    if (issueHasLabel(issue, RELEASE_UPGRADE_LABEL)) {
      continue;
    }

    await githubJsonFn(`/repos/${owner}/${repo}/issues/${issue.number}/labels`, {
      method: "POST",
      body: JSON.stringify({
        labels: [RELEASE_UPGRADE_LABEL],
      }),
    });
    labeled += 1;
  }

  return {
    totalIssues: issues.length,
    posted,
    skipped,
    labeled,
  };
}

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;
  return JSON.parse(readFileSync(eventPath, "utf8"));
}

async function githubJson(path, options = {}) {
  const token = env("GITHUB_TOKEN");
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed: ${response.status} ${body}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function main() {
  const { owner, repo } = parseRepository(env("GITHUB_REPOSITORY"));
  const event = readEvent();
  const release = await resolveRelease(githubJson, owner, repo, event, process.env.RELEASE_TAG || "");
  const releaseTag = release.tag_name || release.name;

  if (!releaseTag) {
    throw new Error("Release tag is required");
  }

  if (release.prerelease) {
    console.log(`Skipping prerelease ${releaseTag}.`);
    return;
  }

  const result = await postReleaseUpgradeComments({
    githubJsonFn: githubJson,
    owner,
    repo,
    releaseTag,
    releaseUrl: release.html_url || "",
  });

  console.log(
    `Posted ${result.posted} release upgrade comments for ${releaseTag}; tagged ${result.labeled} issues with ${RELEASE_UPGRADE_LABEL}; skipped ${result.skipped} already-commented issues across ${result.totalIssues} open issues.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

#!/usr/bin/env node
/**
 * Status probe for the strict-init upstream blocker.
 *
 * GOTCHA: This script uses unauthenticated GitHub REST calls and can hit
 * rate limits if run aggressively in CI. Keep usage to periodic/manual checks.
 */

const strictInitIssueUrl =
  "https://api.github.com/repos/modelcontextprotocol/ext-apps/issues/542";
const strictInitPrUrl =
  "https://api.github.com/repos/modelcontextprotocol/ext-apps/pulls/543";
const npmRegistryUrl =
  "https://registry.npmjs.org/%40modelcontextprotocol%2Fext-apps";

const wantsJson = process.argv.includes("--json");

async function main() {
  const [issue, pullRequest, npmMetadata] = await Promise.all([
    readJson(strictInitIssueUrl),
    readJson(strictInitPrUrl),
    readJson(npmRegistryUrl),
  ]);

  const latestVersion = npmMetadata?.["dist-tags"]?.latest ?? "unknown";
  const latestPublishedAt =
    npmMetadata?.time?.[latestVersion] ?? npmMetadata?.time?.modified ?? null;

  const snapshot = {
    checkedAt: new Date().toISOString(),
    issue: {
      number: issue.number,
      state: issue.state,
      updatedAt: issue.updated_at,
      url: issue.html_url,
    },
    pullRequest: {
      number: pullRequest.number,
      state: pullRequest.state,
      merged: Boolean(pullRequest.merged_at),
      mergedAt: pullRequest.merged_at,
      updatedAt: pullRequest.updated_at,
      url: pullRequest.html_url,
    },
    npm: {
      package: "@modelcontextprotocol/ext-apps",
      latestVersion,
      latestPublishedAt,
    },
  };

  if (wantsJson) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  const lines = [
    "ext-apps strict-init upstream status",
    `checkedAt: ${snapshot.checkedAt}`,
    `issue #${snapshot.issue.number}: ${snapshot.issue.state.toUpperCase()} (updated ${snapshot.issue.updatedAt})`,
    `pull #${snapshot.pullRequest.number}: ${snapshot.pullRequest.state.toUpperCase()} merged=${snapshot.pullRequest.merged} (updated ${snapshot.pullRequest.updatedAt})`,
    `npm latest: ${snapshot.npm.latestVersion} (published ${snapshot.npm.latestPublishedAt ?? "unknown"})`,
    `issue url: ${snapshot.issue.url}`,
    `pull url: ${snapshot.pullRequest.url}`,
  ];
  console.log(lines.join("\n"));
}

async function readJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "mcp-app-room/upstream-strict-init-check",
    },
  });

  if (!response.ok) {
    throw new Error(
      `request failed for ${url}: ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}

await main();

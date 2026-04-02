import test from "node:test";
import assert from "node:assert/strict";
import type { GithubActivityItem } from "./types";
import {
  buildPullRequestContent,
  buildPullRequestExternalId,
  getActivityDedupeKey,
  getActivityPriority,
  getPullRequestStatus,
  parseRepoFromApiUrl,
} from "./activity";

test("parseRepoFromApiUrl extracts owner and repo", () => {
  assert.equal(
    parseRepoFromApiUrl("https://api.github.com/repos/ReadMeIO/testing-repo"),
    "readmeio/testing-repo",
  );
});

test("getPullRequestStatus prefers merged timestamp", () => {
  const status = getPullRequestStatus({
    mergedAt: "2026-04-02T02:00:00.000Z",
    closedAt: "2026-04-02T01:00:00.000Z",
    updatedAt: "2026-04-02T00:00:00.000Z",
    state: "closed",
  });

  assert.equal(status.status, "merged");
  assert.equal(status.createdAt?.toISOString(), "2026-04-02T02:00:00.000Z");
});

test("buildPullRequestContent describes merged pull requests", () => {
  assert.equal(
    buildPullRequestContent(
      "readmeio/testing-repo",
      "LYR-9 PlayTest snake game",
      "merged",
    ),
    "PR merged in readmeio/testing-repo: LYR-9 PlayTest snake game",
  );
});

test("PR dedupe prefers merged activity for the same pull request url", () => {
  const updatedItem: GithubActivityItem = {
    repo: "readmeio/testing-repo",
    title: "LYR-9 PlayTest snake game",
    content: "PR updated in readmeio/testing-repo: LYR-9 PlayTest snake game",
    source: "github_pr",
    externalId: buildPullRequestExternalId(
      "readmeio/testing-repo",
      42,
      "updated",
      "2026-04-02T00:00:00.000Z",
    ),
    externalUrl: "https://github.com/readmeio/testing-repo/pull/42",
    createdAt: new Date("2026-04-02T00:00:00.000Z"),
  };
  const mergedItem: GithubActivityItem = {
    ...updatedItem,
    content: "PR merged in readmeio/testing-repo: LYR-9 PlayTest snake game",
    externalId: buildPullRequestExternalId(
      "readmeio/testing-repo",
      42,
      "merged",
      "2026-04-02T02:00:00.000Z",
    ),
    createdAt: new Date("2026-04-02T02:00:00.000Z"),
  };

  assert.equal(getActivityDedupeKey(updatedItem), getActivityDedupeKey(mergedItem));
  assert.ok(getActivityPriority(mergedItem) > getActivityPriority(updatedItem));
});

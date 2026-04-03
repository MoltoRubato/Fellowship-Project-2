import test from "node:test";
import assert from "node:assert/strict";
import { buildGithubWebhookItems } from "./webhooks";

test("buildGithubWebhookItems expands push commits into activity entries", () => {
  const items = buildGithubWebhookItems("push", {
    repository: {
      full_name: "ReadMeIO/ReadMe",
    },
    commits: [
      {
        id: "abcdef123456",
        message: "Add sync endpoint\n\nMore detail",
        timestamp: "2026-04-03T00:15:00.000Z",
        url: "https://github.com/readmeio/readme/commit/abcdef123456",
      },
      {
        id: "merge123456",
        message: "Merge branch 'main' into feature",
        timestamp: "2026-04-03T00:16:00.000Z",
        url: "https://github.com/readmeio/readme/commit/merge123456",
      },
    ],
  });

  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    repo: "readmeio/readme",
    title: "Add sync endpoint",
    content: "Commit to readmeio/readme: Add sync endpoint",
    source: "github_commit",
    externalId: "github-commit:readmeio/readme:abcdef123456",
    externalUrl: "https://github.com/readmeio/readme/commit/abcdef123456",
    createdAt: new Date("2026-04-03T00:15:00.000Z"),
  });
});

test("buildGithubWebhookItems maps merged pull requests to merged PR activity", () => {
  const items = buildGithubWebhookItems("pull_request", {
    repository: {
      full_name: "readmeio/readme",
    },
    pull_request: {
      number: 42,
      title: "RM-42 Ship webhook delivery",
      html_url: "https://github.com/readmeio/readme/pull/42",
      state: "closed",
      merged: true,
      merged_at: "2026-04-03T01:00:00.000Z",
      closed_at: "2026-04-03T01:00:00.000Z",
      updated_at: "2026-04-03T01:00:00.000Z",
      draft: false,
      requested_reviewers: [{ id: 1 }],
      requested_teams: [],
    },
  });

  assert.equal(items.length, 1);
  assert.equal(items[0]?.content, "PR merged in readmeio/readme: RM-42 Ship webhook delivery");
  assert.equal(
    items[0]?.externalId,
    "github-pr:readmeio/readme:42:merged:2026-04-03T01:00:00.000Z",
  );
  assert.deepEqual(items[0]?.metadata, {
    githubPr: {
      number: 42,
      state: "closed",
      draft: false,
      awaitingReview: false,
      reviewRequested: true,
      requestedReviewerCount: 1,
      requestedTeamCount: 0,
    },
  });
});

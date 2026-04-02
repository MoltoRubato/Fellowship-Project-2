import test from "node:test";
import assert from "node:assert/strict";
import { EntrySource, EntryType } from "@prisma/client";
import type { SummaryLogEntry } from "./types";
import { buildFallbackSummary } from "./fallback";

function makeEntry(overrides: Partial<SummaryLogEntry>): SummaryLogEntry {
  return {
    id: "entry-1",
    displayId: 1,
    displayDateKey: "2026-04-02",
    userId: "user-1",
    projectId: "project-1",
    content: "Default content",
    entryType: EntryType.update,
    source: EntrySource.manual,
    title: null,
    externalId: null,
    externalUrl: null,
    metadata: null,
    createdAt: new Date("2026-04-02T09:00:00.000Z"),
    updatedAt: new Date("2026-04-02T09:00:00.000Z"),
    deletedAt: null,
    project: {
      id: "project-1",
      userId: "user-1",
      githubRepo: "readmeio/testing-repo",
      githubRepoUrl: "https://github.com/readmeio/testing-repo",
      githubRepoId: "123",
      githubRepoUpdatedAt: new Date("2026-04-01T00:00:00.000Z"),
      linearTeamId: null,
      linearProjectId: null,
      linearProjectName: null,
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-01T00:00:00.000Z"),
      lastUsedAt: new Date("2026-04-01T00:00:00.000Z"),
    },
    ...overrides,
  };
}

test("fallback summary prefers PR titles as the ticket heading when PRs exist", () => {
  const summary = buildFallbackSummary({
    updateNo: 1,
    period: "week",
    entries: [
      makeEntry({
        id: "commit-1",
        source: EntrySource.github_commit,
        title: "LYR-9 add mobile touch controls",
        content: "Commit to readmeio/testing-repo: LYR-9 add mobile touch controls",
        externalId: "github-commit:readmeio/testing-repo:abcdef123456",
        externalUrl: "https://github.com/readmeio/testing-repo/commit/abcdef123456",
      }),
      makeEntry({
        id: "pr-1",
        source: EntrySource.github_pr,
        title: "LYR-9 PlayTest snake game",
        content: "PR merged in readmeio/testing-repo: LYR-9 PlayTest snake game",
        externalId: "github-pr:readmeio/testing-repo:42:merged:2026-04-02T10:00:00.000Z",
        externalUrl: "https://github.com/readmeio/testing-repo/pull/42",
        createdAt: new Date("2026-04-02T10:00:00.000Z"),
      }),
    ],
    blockers: [],
  }).summary;

  assert.ok(summary);
  assert.match(summary!, /- LYR-9 - PlayTest snake game \[ref:pr_42]/);
});

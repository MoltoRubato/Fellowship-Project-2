import test from "node:test";
import assert from "node:assert/strict";
import { EntrySource, EntryType } from "@prisma/client";
import type { SummaryLogEntry } from "./types";
import { renderSummaryForSlack, isStructuredTicketSummary } from "./slack-format";

function makeEntry(
  overrides: Partial<SummaryLogEntry>,
): SummaryLogEntry {
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
      githubRepo: "readmeio/readme",
      githubRepoUrl: "https://github.com/readmeio/readme",
      githubRepoId: "123",
      githubRepoUpdatedAt: new Date("2026-04-01T00:00:00.000Z"),
      linearTeamId: "team-1",
      linearProjectId: "linear-project-1",
      linearProjectName: "Docs Audit",
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-01T00:00:00.000Z"),
      lastUsedAt: new Date("2026-04-01T00:00:00.000Z"),
    },
    ...overrides,
  };
}

test("isStructuredTicketSummary validates the new grouped format", () => {
  assert.equal(
    isStructuredTicketSummary("Weekly update :male-technologist::\n\n- RM-1 - Example"),
    true,
  );
  assert.equal(
    isStructuredTicketSummary("Weekly update :male-technologist::\n\n## Status snapshot\n- Wrapped up API work.\n\n## RM-1 - Example\n- Landed the fix."),
    true,
  );
  assert.equal(isStructuredTicketSummary("Update #1\nToday's work:\n- Something"), false);
});

test("renderSummaryForSlack embeds group links in the heading", () => {
  const entries: SummaryLogEntry[] = [
    makeEntry({
      id: "linear-1",
      source: EntrySource.linear_issue,
      title: "RM-15476 MCP Dropdown Reliability",
      content: "RM-15476 moved to In Progress",
      externalId: "linear-issue:RM-15476:2026-04-02T09:00:00.000Z",
      externalUrl: "https://linear.app/readme/issue/RM-15476",
    }),
    makeEntry({
      id: "pr-1",
      source: EntrySource.github_pr,
      title: "RM-15476 MCP revamp",
      content: "PR merged in readmeio/readme: RM-15476 MCP revamp",
      externalId: "github-pr:readmeio/readme:17883:merged:2026-04-02T09:30:00.000Z",
      externalUrl: "https://github.com/readmeio/readme/pull/17883",
    }),
    makeEntry({
      id: "commit-1",
      source: EntrySource.github_commit,
      title: "RM-15476 remove stale dropdown state",
      content: "Commit to readmeio/readme: RM-15476 remove stale dropdown state",
      externalId: "github-commit:readmeio/readme:abcdef1234567",
      externalUrl: "https://github.com/readmeio/readme/commit/abcdef1234567",
      createdAt: new Date("2026-04-02T10:00:00.000Z"),
    }),
  ];

  const rendered = renderSummaryForSlack(
    [
      "Weekly update :male-technologist::",
      "",
      "- RM-15476 - MCP Dropdown Reliability [ref:linear_rm_15476]",
      "  - Reviewed and approved the MCP revamp PR. [ref:pr_17883]",
      "- Other",
      "  - Reviewed PRs throughout the week.",
      "",
      "Next up:",
      "- Finish manual tests.",
    ].join("\n"),
    entries,
  );

  assert.match(
    rendered,
    /\*Status snapshot\*/,
  );
  assert.match(
    rendered,
    /\*<https:\/\/linear\.app\/readme\/issue\/RM-15476\|RM-15476 - MCP Dropdown Reliability>\* · <https:\/\/github\.com\/readmeio\/readme\/pull\/17883\|PR>/,
  );
  assert.match(rendered, /- Reviewed and approved the MCP revamp PR\./);
  assert.doesNotMatch(rendered, /https:\/\/github\.com\/readmeio\/readme\/commit\//);
  assert.doesNotMatch(rendered, /- Linear:/);
  assert.doesNotMatch(rendered, /- PR:/);
  assert.match(rendered, /\*Other\*/);
  assert.doesNotMatch(rendered, /Next up:/);
});

test("renderSummaryForSlack uses a single compare footer link for commit-only work", () => {
  const entries: SummaryLogEntry[] = [
    makeEntry({
      id: "commit-1",
      source: EntrySource.github_commit,
      title: "LYR-8 Add HTML structure and CSS styling",
      content: "Commit to readmeio/readme: LYR-8 Add HTML structure and CSS styling",
      externalId: "github-commit:readmeio/readme:abcdef1234567",
      externalUrl: "https://github.com/readmeio/readme/commit/abcdef1234567",
      createdAt: new Date("2026-04-02T09:00:00.000Z"),
    }),
    makeEntry({
      id: "commit-2",
      source: EntrySource.github_commit,
      title: "LYR-8 Add core snake game logic with rendering",
      content: "Commit to readmeio/readme: LYR-8 Add core snake game logic with rendering",
      externalId: "github-commit:readmeio/readme:fedcba7654321",
      externalUrl: "https://github.com/readmeio/readme/commit/fedcba7654321",
      createdAt: new Date("2026-04-02T10:00:00.000Z"),
    }),
  ];

  const rendered = renderSummaryForSlack(
    [
      "Daily update :male-technologist::",
      "",
      "- LYR-8 Create new repo for Snake game webapp",
      "  - Added HTML structure and CSS styling. [ref:commit_readmeio_readme_abcdef123456]",
      "  - Added core snake game logic with rendering. [ref:commit_readmeio_readme_fedcba765432]",
    ].join("\n"),
    entries,
  );

  assert.match(rendered, /\*Status snapshot\*/);
  assert.match(
    rendered,
    /\*LYR-8 Create new repo for Snake game webapp\* · <https:\/\/github\.com\/readmeio\/readme\/compare\/abcdef1234567\.\.fedcba7654321\|Compare>/,
  );
  assert.match(rendered, /- Added HTML structure and CSS styling\./);
  assert.match(rendered, /- Added core snake game logic with rendering\./);
  assert.doesNotMatch(rendered, /- Compare:/);
  assert.doesNotMatch(rendered, /\|commit>/);
});

test("renderSummaryForSlack backfills nested bullets when a ticket heading is empty", () => {
  const entries: SummaryLogEntry[] = [
    makeEntry({
      id: "commit-1",
      source: EntrySource.github_commit,
      title: "LYR-9 Add mobile touch controls and responsive layout",
      content: "Commit to readmeio/readme: LYR-9 Add mobile touch controls and responsive layout",
      externalId: "github-commit:readmeio/readme:1111111111111",
      externalUrl: "https://github.com/readmeio/readme/commit/1111111111111",
      createdAt: new Date("2026-04-02T11:00:00.000Z"),
    }),
    makeEntry({
      id: "commit-2",
      source: EntrySource.github_commit,
      title: "LYR-9 Add pause functionality and sound effects",
      content: "Commit to readmeio/readme: LYR-9 Add pause functionality and sound effects",
      externalId: "github-commit:readmeio/readme:2222222222222",
      externalUrl: "https://github.com/readmeio/readme/commit/2222222222222",
      createdAt: new Date("2026-04-02T12:00:00.000Z"),
    }),
  ];

  const rendered = renderSummaryForSlack(
    [
      "Daily update :male-technologist::",
      "",
      "- LYR-9 PlayTest snake game",
    ].join("\n"),
    entries,
  );

  assert.match(
    rendered,
    /\*LYR-9 PlayTest snake game\* · <https:\/\/github\.com\/readmeio\/readme\/compare\/1111111111111\.\.2222222222222\|Compare>/,
  );
  assert.match(rendered, /- Add mobile touch controls and responsive layout/);
  assert.match(rendered, /- Add pause functionality and sound effects/);
  assert.doesNotMatch(rendered, /- Compare:/);
});

test("renderSummaryForSlack does not repeat a PR link under a PR-linked title", () => {
  const entries: SummaryLogEntry[] = [
    makeEntry({
      id: "pr-1",
      source: EntrySource.github_pr,
      title: "Add game switcher and Tetris game",
      content: "PR merged in readmeio/readme: Add game switcher and Tetris game",
      externalId: "github-pr:20001:merged",
      externalUrl: "https://github.com/readmeio/readme/pull/20001",
    }),
    makeEntry({
      id: "commit-1",
      source: EntrySource.github_commit,
      title: "Refactor into game-switcher architecture with tab navigation",
      content: "Commit to readmeio/readme: Refactor into game-switcher architecture with tab navigation",
      externalId: "github-commit:readmeio/readme:3333333333333",
      externalUrl: "https://github.com/readmeio/readme/commit/3333333333333",
      createdAt: new Date("2026-04-02T11:00:00.000Z"),
    }),
  ];

  const rendered = renderSummaryForSlack(
    [
      "Daily update :male-technologist::",
      "",
      "- GitHub PR: Add game switcher and Tetris game [ref:pr_20001]",
      "  - Refactor into game-switcher architecture with tab navigation. [ref:commit_readmeio_readme_333333333333]",
    ].join("\n"),
    entries,
  );

  assert.match(
    rendered,
    /\*<https:\/\/github\.com\/readmeio\/readme\/pull\/20001\|GitHub PR: Add game switcher and Tetris game>\*/,
  );
  assert.match(rendered, /- Refactor into game-switcher architecture with tab navigation\./);
  assert.doesNotMatch(rendered, /- Compare:/);
  assert.doesNotMatch(rendered, /- PR:/);
});

test("renderSummaryForSlack limits Other to five visible updates", () => {
  const rendered = renderSummaryForSlack(
    [
      "Daily update :male-technologist::",
      "",
      "- Other",
      "  - One",
      "  - Two",
      "  - Three",
      "  - Four",
      "  - Five",
      "  - Six",
    ].join("\n"),
    [],
  );

  assert.match(rendered, /\*Other\*/);
  assert.match(rendered, /- One/);
  assert.match(rendered, /- Five/);
  assert.doesNotMatch(rendered, /- Six/);
});

test("renderSummaryForSlack renders a needs review section for open PRs", () => {
  const entries: SummaryLogEntry[] = [
    makeEntry({
      id: "pr-1",
      source: EntrySource.github_pr,
      title: "RM-200 Fix review callout",
      content: "PR updated in readmeio/readme: RM-200 Fix review callout",
      externalId: "github-pr:readmeio/readme:200:updated:2026-04-02T11:00:00.000Z",
      externalUrl: "https://github.com/readmeio/readme/pull/200",
      metadata: {
        githubPr: {
          number: 200,
          state: "open",
          draft: false,
          awaitingReview: true,
          reviewRequested: true,
          requestedReviewerCount: 1,
          requestedTeamCount: 0,
        },
      },
      createdAt: new Date("2026-04-02T11:00:00.000Z"),
    }),
  ];

  const rendered = renderSummaryForSlack(
    [
      "Weekly update :male-technologist::",
      "",
      "## Status snapshot",
      "- Wrapped up the implementation and opened the PR.",
      "",
      "## RM-200 - Fix review callout [ref:pr_200]",
      "- Finished the formatter changes. [ref:pr_200]",
    ].join("\n"),
    entries,
  );

  assert.match(rendered, /\*Needs review\*/);
  assert.match(
    rendered,
    /- <https:\/\/github\.com\/readmeio\/readme\/pull\/200\|RM-200 - Fix review callout>/,
  );
});

test("renderSummaryForSlack compresses a redundant PR status bullet", () => {
  const entries: SummaryLogEntry[] = [
    makeEntry({
      id: "pr-1",
      source: EntrySource.github_pr,
      title: "Add 3D FPS shooter game with Three.js",
      content: "PR merged in readmeio/readme: Add 3D FPS shooter game with Three.js",
      externalId: "github-pr:readmeio/readme:3:merged:2026-04-02T11:00:00.000Z",
      externalUrl: "https://github.com/readmeio/readme/pull/3",
      createdAt: new Date("2026-04-02T11:00:00.000Z"),
    }),
  ];

  const rendered = renderSummaryForSlack(
    [
      "Daily update :male-technologist::",
      "",
      "## Add 3D FPS shooter game with Three.js [ref:pr_3]",
      "- PR merged: Add 3D FPS shooter game with Three.js [ref:pr_3]",
    ].join("\n"),
    entries,
  );

  assert.match(rendered, /- Merged PR/);
  assert.doesNotMatch(rendered, /- PR merged: Add 3D FPS shooter game with Three\.js/);
});

test("renderSummaryForSlack does not add needs review for open PRs without a review request", () => {
  const entries: SummaryLogEntry[] = [
    makeEntry({
      id: "pr-1",
      source: EntrySource.github_pr,
      title: "Draft follow-up",
      content: "PR updated in readmeio/readme: Draft follow-up",
      externalId: "github-pr:readmeio/readme:201:updated:2026-04-02T11:00:00.000Z",
      externalUrl: "https://github.com/readmeio/readme/pull/201",
      metadata: {
        githubPr: {
          number: 201,
          state: "open",
          draft: false,
          awaitingReview: false,
          reviewRequested: false,
          requestedReviewerCount: 0,
          requestedTeamCount: 0,
        },
      },
      createdAt: new Date("2026-04-02T11:00:00.000Z"),
    }),
  ];

  const rendered = renderSummaryForSlack(
    [
      "Daily update :male-technologist::",
      "",
      "## Draft follow-up [ref:pr_201]",
      "- Continued implementation work.",
    ].join("\n"),
    entries,
  );

  assert.doesNotMatch(rendered, /\*Needs review\*/);
});

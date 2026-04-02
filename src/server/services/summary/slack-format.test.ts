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
  assert.equal(isStructuredTicketSummary("Update #1\nToday's work:\n- Something"), false);
});

test("renderSummaryForSlack hyperlinks top-level ticket headings and nested refs", () => {
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
      content: "PR reviewed in readmeio/readme: RM-15476 MCP revamp",
      externalId: "github-pr:17883:reviewed",
      externalUrl: "https://github.com/readmeio/readme/pull/17883",
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
    /• <https:\/\/linear\.app\/readme\/issue\/RM-15476\|RM-15476 - MCP Dropdown Reliability>/,
  );
  assert.match(
    rendered,
    /◦ Reviewed and approved the MCP revamp PR\. <https:\/\/github\.com\/readmeio\/readme\/pull\/17883\|PR>/,
  );
  assert.match(rendered, /• Other/);
  assert.match(rendered, /Next up:\n• Finish manual tests\./);
});

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

function makeEntryForRepo(repo: string, overrides: Partial<SummaryLogEntry>): SummaryLogEntry {
  return makeEntry({
    project: {
      id: "project-1",
      userId: "user-1",
      githubRepo: repo,
      githubRepoUrl: `https://github.com/${repo}`,
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
  });
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

test("fallback summary groups unticketed repo work under the only PR title for that repo", () => {
  const summary = buildFallbackSummary({
    updateNo: 1,
    period: "today",
    entries: [
      makeEntry({
        id: "pr-1",
        source: EntrySource.github_pr,
        title: "Add weapon arsenal, enemy health bars, pickups, combos, and wave banners",
        content:
          "PR updated in readmeio/testing-repo: Add weapon arsenal, enemy health bars, pickups, combos, and wave banners",
        externalId: "github-pr:readmeio/testing-repo:52:updated:2026-04-02T10:00:00.000Z",
        externalUrl: "https://github.com/readmeio/testing-repo/pull/52",
        createdAt: new Date("2026-04-02T10:00:00.000Z"),
      }),
      makeEntry({
        id: "commit-1",
        source: EntrySource.github_commit,
        title: "Add 3D FPS shooter game with Three.js rendering",
        content: "Commit to readmeio/testing-repo: Add 3D FPS shooter game with Three.js rendering",
        externalId: "github-commit:readmeio/testing-repo:abcdef123456",
        externalUrl: "https://github.com/readmeio/testing-repo/commit/abcdef123456",
        createdAt: new Date("2026-04-02T11:00:00.000Z"),
      }),
    ],
    blockers: [],
  }).summary;

  assert.ok(summary);
  assert.match(summary!, /- Add weapon arsenal, enemy health bars, pickups, combos, and wave banners \[ref:pr_52]/);
  assert.match(summary!, /  - Updated PR \[ref:pr_52]/);
  assert.match(summary!, /  - Add 3D FPS shooter game with Three\.js rendering \[ref:commit_readmeio_testing_repo_abcdef123456]/);
  assert.doesNotMatch(summary!, /- Other/);
});

test("fallback summary matches unticketed commits to the best PR group within the same repo", () => {
  const summary = buildFallbackSummary({
    updateNo: 1,
    period: "today",
    entries: [
      makeEntry({
        id: "pr-3",
        source: EntrySource.github_pr,
        title: "Add 3D FPS shooter game with Three.js",
        content: "PR merged in readmeio/testing-repo: Add 3D FPS shooter game with Three.js",
        externalId: "github-pr:readmeio/testing-repo:3:merged:2026-04-02T09:00:00.000Z",
        externalUrl: "https://github.com/readmeio/testing-repo/pull/3",
        createdAt: new Date("2026-04-02T09:00:00.000Z"),
      }),
      makeEntry({
        id: "pr-4",
        source: EntrySource.github_pr,
        title: "Add weapon model, minimap, hitmarkers, and kill feed",
        content: "PR merged in readmeio/testing-repo: Add weapon model, minimap, hitmarkers, and kill feed",
        externalId: "github-pr:readmeio/testing-repo:4:merged:2026-04-02T10:00:00.000Z",
        externalUrl: "https://github.com/readmeio/testing-repo/pull/4",
        createdAt: new Date("2026-04-02T10:00:00.000Z"),
      }),
      makeEntry({
        id: "pr-5",
        source: EntrySource.github_pr,
        title: "Add weapon arsenal, enemy health bars, pickups, combos, and wave banners",
        content:
          "PR updated in readmeio/testing-repo: Add weapon arsenal, enemy health bars, pickups, combos, and wave banners",
        externalId: "github-pr:readmeio/testing-repo:5:updated:2026-04-02T11:00:00.000Z",
        externalUrl: "https://github.com/readmeio/testing-repo/pull/5",
        createdAt: new Date("2026-04-02T11:00:00.000Z"),
      }),
      makeEntry({
        id: "commit-1",
        source: EntrySource.github_commit,
        title: "Add 3D FPS shooter game with Three.js rendering",
        content: "Commit to readmeio/testing-repo: Add 3D FPS shooter game with Three.js rendering",
        externalId: "github-commit:readmeio/testing-repo:111111111111",
        externalUrl: "https://github.com/readmeio/testing-repo/commit/111111111111",
        createdAt: new Date("2026-04-02T09:30:00.000Z"),
      }),
      makeEntry({
        id: "commit-2",
        source: EntrySource.github_commit,
        title: "Add first-person weapon model, weapon sway, and minimap",
        content: "Commit to readmeio/testing-repo: Add first-person weapon model, weapon sway, and minimap",
        externalId: "github-commit:readmeio/testing-repo:222222222222",
        externalUrl: "https://github.com/readmeio/testing-repo/commit/222222222222",
        createdAt: new Date("2026-04-02T10:30:00.000Z"),
      }),
      makeEntry({
        id: "commit-3",
        source: EntrySource.github_commit,
        title: "Add hitmarkers, kill feed, and screen shake effects",
        content: "Commit to readmeio/testing-repo: Add hitmarkers, kill feed, and screen shake effects",
        externalId: "github-commit:readmeio/testing-repo:333333333333",
        externalUrl: "https://github.com/readmeio/testing-repo/commit/333333333333",
        createdAt: new Date("2026-04-02T10:45:00.000Z"),
      }),
      makeEntry({
        id: "commit-4",
        source: EntrySource.github_commit,
        title: "Fix click-to-start not working in shooter game",
        content: "Commit to readmeio/testing-repo: Fix click-to-start not working in shooter game",
        externalId: "github-commit:readmeio/testing-repo:444444444444",
        externalUrl: "https://github.com/readmeio/testing-repo/commit/444444444444",
        createdAt: new Date("2026-04-02T11:30:00.000Z"),
      }),
    ],
    blockers: [],
  }).summary;

  assert.ok(summary);
  assert.match(summary!, /- Add 3D FPS shooter game with Three\.js \[ref:pr_3]/);
  assert.match(summary!, /  - Merged PR \[ref:pr_3]/);
  assert.match(summary!, /  - Add 3D FPS shooter game with Three\.js rendering \[ref:commit_readmeio_testing_repo_111111111111]/);
  assert.match(summary!, /- Add weapon model, minimap, hitmarkers, and kill feed \[ref:pr_4]/);
  assert.match(summary!, /  - Add first-person weapon model, weapon sway, and minimap \[ref:commit_readmeio_testing_repo_222222222222]/);
  assert.match(summary!, /  - Add hitmarkers, kill feed, and screen shake effects \[ref:commit_readmeio_testing_repo_333333333333]/);
  assert.match(summary!, /- Add weapon arsenal, enemy health bars, pickups, combos, and wave banners \[ref:pr_5]/);
  assert.match(summary!, /  - Updated PR \[ref:pr_5]/);
  assert.match(summary!, /  - Fix click-to-start not working in shooter game \[ref:commit_readmeio_testing_repo_444444444444]/);
  assert.doesNotMatch(summary!, /- Other/);
});

test("fallback summary keeps repo prefixes only for leftover Other items", () => {
  const summary = buildFallbackSummary({
    updateNo: 1,
    period: "today",
    entries: [
      makeEntryForRepo("moltorubato/testing_repo", {
        id: "pr-1",
        source: EntrySource.github_pr,
        title: "Add 3D FPS shooter game with Three.js",
        content: "PR merged in moltorubato/testing_repo: Add 3D FPS shooter game with Three.js",
        externalId: "github-pr:moltorubato/testing_repo:3:merged:2026-04-02T09:00:00.000Z",
        externalUrl: "https://github.com/moltorubato/testing_repo/pull/3",
      }),
      makeEntryForRepo("moltorubato/testing_repo", {
        id: "commit-1",
        source: EntrySource.github_commit,
        title: "Add 3D FPS shooter game with Three.js rendering",
        content: "Commit to moltorubato/testing_repo: Add 3D FPS shooter game with Three.js rendering",
        externalId: "github-commit:moltorubato/testing_repo:abcdef123456",
        externalUrl: "https://github.com/moltorubato/testing_repo/commit/abcdef123456",
        createdAt: new Date("2026-04-02T09:30:00.000Z"),
      }),
      makeEntryForRepo("moltorubato/fellowship-project-2", {
        id: "manual-1",
        source: EntrySource.manual,
        content: "Ran testing session",
        createdAt: new Date("2026-04-02T10:00:00.000Z"),
      }),
      makeEntryForRepo("moltorubato/fellowship-project-2", {
        id: "commit-2",
        source: EntrySource.github_commit,
        title: "Add retention controls and harden bot delivery",
        content: "Commit to moltorubato/fellowship-project-2: Add retention controls and harden bot delivery",
        externalId: "github-commit:moltorubato/fellowship-project-2:123456abcdef",
        externalUrl: "https://github.com/moltorubato/fellowship-project-2/commit/123456abcdef",
        createdAt: new Date("2026-04-02T10:30:00.000Z"),
      }),
    ],
    blockers: [],
  }).summary;

  assert.ok(summary);
  assert.match(summary!, /- Add 3D FPS shooter game with Three\.js \[ref:pr_3]/);
  assert.match(summary!, /  - Add 3D FPS shooter game with Three\.js rendering \[ref:commit_moltorubato_testing_repo_abcdef123456]/);
  assert.doesNotMatch(summary!, /\[moltorubato\/testing_repo] Add 3D FPS shooter game with Three\.js rendering/);
  assert.match(summary!, /- Other/);
  assert.match(summary!, /  - \[moltorubato\/fellowship-project-2] Add retention controls and harden bot delivery \[ref:commit_moltorubato_fellowship_project_2_123456abcdef]/);
});

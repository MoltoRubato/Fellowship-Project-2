import type { App } from "@slack/bolt";
import type { ViewArgs, EntryModalItem } from "./types.js";
import {
  ensureSlackUser,
  getUserContextBySlackId,
  normalizeRepo,
  isRepoLike,
  type UserContext,
} from "@/server/services/standup";
import { sendAuthLinkDm } from "@/server/services/slack";

// ── Block / Action IDs ───────────────────────────────────────────────

export const ENTRY_MODAL_CALLBACK_ID = "standup_entry_submit";
export const SUMMARY_MODAL_CALLBACK_ID = "standup_summary_submit";
export const EDIT_MODAL_CALLBACK_ID = "standup_edit_submit";
export const DELETE_MODAL_CALLBACK_ID = "standup_delete_submit";
export const REPO_SELECT_BLOCK_ID = "repo_select_block";
export const REPO_SELECT_ACTION_ID = "repo_select_action";
export const SUMMARY_REPO_PICK_ACTION_ID = "summary_repo_pick";
export const REPO_INPUT_BLOCK_ID = "repo_input_block";
export const REPO_INPUT_ACTION_ID = "repo_input_action";
export const MESSAGE_BLOCK_ID = "message_block";
export const MESSAGE_ACTION_ID = "message_action";
export const ENTRY_SELECT_BLOCK_ID = "entry_select_block";
export const ENTRY_SELECT_ACTION_ID = "entry_select_action";
export const ENTRY_PREVIEW_BLOCK_ID = "entry_preview_block";
export const EDIT_TEXT_BLOCK_ID = "edit_text_block";
export const EDIT_TEXT_ACTION_ID = "edit_text_action";

export const ENTRY_MODAL_RECENT_LIMIT = 12;
export const ENTRY_MODAL_METADATA_MAX_CHARS = 2900;

// ── Formatting helpers ───────────────────────────────────────────────

export function truncatePlainText(text: string, max = 75) {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3))}...`;
}

export function formatProjectLabel(project?: {
  githubRepo: string;
  linearProjectName?: string | null;
} | null) {
  if (!project) {
    return "No repo";
  }

  const linearLabel = project.linearProjectName ? ` | ${project.linearProjectName}` : "";
  return truncatePlainText(`${project.githubRepo}${linearLabel}`);
}

export function buildProjectOption(project: {
  githubRepo: string;
  linearProjectName?: string | null;
}) {
  return {
    text: {
      type: "plain_text" as const,
      text: formatProjectLabel(project),
    },
    value: project.githubRepo,
  };
}

export function toEntryModalItem(entry: {
  displayId: number;
  content: string;
  project?: { githubRepo: string; linearProjectName?: string | null } | null;
}): EntryModalItem {
  return {
    displayId: entry.displayId,
    content: entry.content,
    repoLabel: entry.project ? formatProjectLabel(entry.project) : "No repo",
  };
}

export function buildEntryOption(entry: EntryModalItem) {
  const text = truncatePlainText(`#${entry.displayId} | ${entry.repoLabel} | ${entry.content}`);
  return {
    text: {
      type: "plain_text" as const,
      text,
    },
    value: String(entry.displayId),
  };
}

export function buildEntryPreviewText(entry: EntryModalItem) {
  const quotedContent = entry.content
    .split("\n")
    .map((line) => `>${line}`)
    .join("\n");

  return `*Selected entry*\n*#${entry.displayId}* • ${entry.repoLabel}\n${quotedContent}`;
}

export function sanitizeEntryModalCache(value: unknown): EntryModalItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const candidate = item as {
        displayId?: unknown;
        content?: unknown;
        repoLabel?: unknown;
      };
      const displayId = Number(candidate.displayId);
      const content = typeof candidate.content === "string" ? candidate.content : "";
      const repoLabel = typeof candidate.repoLabel === "string" ? candidate.repoLabel : "No repo";

      if (!Number.isInteger(displayId) || displayId <= 0 || !content.trim()) {
        return null;
      }

      return {
        displayId,
        content,
        repoLabel,
      };
    })
    .filter((item): item is EntryModalItem => Boolean(item));
}

export function buildEntryManagementMetadata(input: {
  channelId: string;
  teamId: string;
  responseUrl?: string;
  selectedDisplayId: number;
  entries: EntryModalItem[];
}) {
  const baseMetadata = {
    channelId: input.channelId,
    teamId: input.teamId,
    responseUrl: input.responseUrl,
    selectedDisplayId: input.selectedDisplayId,
  };

  const withCache = {
    ...baseMetadata,
    entryCache: input.entries,
  };
  const serialized = JSON.stringify(withCache);

  if (serialized.length <= ENTRY_MODAL_METADATA_MAX_CHARS) {
    return serialized;
  }

  return JSON.stringify(baseMetadata);
}

// ── Project / repo helpers ───────────────────────────────────────────

function getProjectTimestamp(value?: Date | null) {
  return value instanceof Date ? value.getTime() : 0;
}

export function sortProjectsForRepoPicker(projects: UserContext["projects"]) {
  return [...projects].sort((left, right) => {
    const updatedDelta =
      getProjectTimestamp(right.githubRepoUpdatedAt) - getProjectTimestamp(left.githubRepoUpdatedAt);
    if (updatedDelta !== 0) {
      return updatedDelta;
    }

    const usedDelta = getProjectTimestamp(right.lastUsedAt) - getProjectTimestamp(left.lastUsedAt);
    if (usedDelta !== 0) {
      return usedDelta;
    }

    return left.githubRepo.localeCompare(right.githubRepo);
  });
}

export function getMostRecentlyUpdatedRepo(user?: UserContext | null) {
  if (!user?.projects.length) {
    return user?.defaultProject?.githubRepo ?? null;
  }

  const [project] = sortProjectsForRepoPicker(user.projects);

  return project?.githubRepo ?? user.defaultProject?.githubRepo ?? null;
}

export function sortRepoNamesForRepoPicker(repoNames: string[], user?: UserContext | null) {
  const orderedProjects = sortProjectsForRepoPicker(
    (user?.projects ?? []).filter((project) => repoNames.includes(project.githubRepo)),
  );
  const orderedRepoNames = orderedProjects.map((project) => project.githubRepo);
  const remainingRepoNames = repoNames
    .filter((repo) => !orderedRepoNames.includes(repo))
    .sort((left, right) => left.localeCompare(right));

  return [...orderedRepoNames, ...remainingRepoNames];
}

// ── Parsing helpers ──────────────────────────────────────────────────

export function parseRepoAndText(rawText: string, defaultRepo?: string | null) {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return {
      repo: defaultRepo ? normalizeRepo(defaultRepo) : null,
      text: "",
    };
  }

  const parts = trimmed.split(/\s+/);
  const firstToken = parts[0];

  if (isRepoLike(firstToken)) {
    return {
      repo: normalizeRepo(firstToken),
      text: parts.slice(1).join(" ").trim(),
    };
  }

  return {
    repo: defaultRepo ? normalizeRepo(defaultRepo) : null,
    text: trimmed,
  };
}

export function parseEditArgs(rawText: string, defaultRepo?: string | null) {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  let index = 0;
  let repo = defaultRepo ? normalizeRepo(defaultRepo) : null;

  if (isRepoLike(parts[0])) {
    repo = normalizeRepo(parts[0]);
    index = 1;
  }

  const displayId = Number(parts[index]);
  const text = parts.slice(index + 1).join(" ").trim();

  if (!Number.isInteger(displayId) || displayId <= 0) {
    return null;
  }

  return { repo, displayId, text };
}

export function parseDeleteArgs(rawText: string, defaultRepo?: string | null) {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  let repo = defaultRepo ? normalizeRepo(defaultRepo) : null;
  let idToken = parts[0];

  if (isRepoLike(parts[0])) {
    repo = normalizeRepo(parts[0]);
    idToken = parts[1] ?? "";
  }

  const displayId = Number(idToken);
  if (!Number.isInteger(displayId) || displayId <= 0) {
    return null;
  }

  return { repo, displayId };
}

export function parseSummaryArgs(rawText: string) {
  const parts = rawText.trim().split(/\s+/).filter(Boolean);
  let period: "today" | "week" = "today";
  let repo = null as string | null;

  for (const part of parts) {
    if (part.toLowerCase() === "week") {
      period = "week";
      continue;
    }

    if (isRepoLike(part)) {
      repo = normalizeRepo(part);
    }
  }

  return { repo, period };
}

// ── Modal helpers ────────────────────────────────────────────────────

export function resolveRepoFromModal(view: ViewArgs["view"]) {
  const selectedRepo =
    view.state.values[REPO_SELECT_BLOCK_ID]?.[REPO_SELECT_ACTION_ID] &&
    "selected_option" in view.state.values[REPO_SELECT_BLOCK_ID][REPO_SELECT_ACTION_ID]
      ? view.state.values[REPO_SELECT_BLOCK_ID][REPO_SELECT_ACTION_ID].selected_option?.value
      : undefined;

  const typedRepo =
    view.state.values[REPO_INPUT_BLOCK_ID]?.[REPO_INPUT_ACTION_ID] &&
    "value" in view.state.values[REPO_INPUT_BLOCK_ID][REPO_INPUT_ACTION_ID]
      ? view.state.values[REPO_INPUT_BLOCK_ID][REPO_INPUT_ACTION_ID].value
      : undefined;

  return normalizeRepo(selectedRepo ?? typedRepo ?? null);
}

export function resolveDisplayIdFromModal(view: ViewArgs["view"]) {
  const selectedValue =
    view.state.values[ENTRY_SELECT_BLOCK_ID]?.[ENTRY_SELECT_ACTION_ID] &&
    "selected_option" in view.state.values[ENTRY_SELECT_BLOCK_ID][ENTRY_SELECT_ACTION_ID]
      ? view.state.values[ENTRY_SELECT_BLOCK_ID][ENTRY_SELECT_ACTION_ID].selected_option?.value
      : undefined;
  const displayId = Number(selectedValue ?? "");

  return Number.isInteger(displayId) && displayId > 0 ? displayId : null;
}

export function resolveEditTextFromModal(view: ViewArgs["view"]) {
  const matchingBlockId = Object.keys(view.state.values).find((blockId) => blockId.startsWith(EDIT_TEXT_BLOCK_ID));
  const matchingActionId = matchingBlockId
    ? Object.keys(view.state.values[matchingBlockId] ?? {}).find((actionId) => actionId.startsWith(EDIT_TEXT_ACTION_ID))
    : undefined;
  const value =
    matchingBlockId &&
    matchingActionId &&
    view.state.values[matchingBlockId]?.[matchingActionId] &&
    "value" in view.state.values[matchingBlockId][matchingActionId]
      ? view.state.values[matchingBlockId][matchingActionId].value
      : "";

  return (value ?? "").trim();
}

// ── Slack response helpers ───────────────────────────────────────────

export async function resolveDefaultRepo(slackUserId: string) {
  const user = await getUserContextBySlackId(slackUserId);
  return user?.defaultProject?.githubRepo ?? user?.projects[0]?.githubRepo ?? null;
}

export async function loadUserForEntryModal(slackUserId: string, slackTeamId: string) {
  const { created } = await ensureSlackUser(slackUserId, slackTeamId);
  const user = await getUserContextBySlackId(slackUserId);
  return { created, user };
}

export async function maybeSendOnboardingLink(slackUserId: string, slackTeamId: string, created: boolean) {
  if (!created) {
    return false;
  }

  await sendAuthLinkDm({
    slackUserId,
    slackTeamId,
    reason: "You can start logging immediately, and this link lets you connect GitHub and Linear when you're ready.",
  });

  return true;
}

export async function postToResponseUrl(
  responseUrl: string,
  payload: {
    text: string;
    response_type?: "ephemeral" | "in_channel";
    replace_original?: boolean;
    delete_original?: boolean;
  },
) {
  await fetch(responseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function sendModalConfirmation(
  client: App["client"],
  channelId: string,
  userId: string,
  text: string,
  responseUrl?: string,
) {
  if (responseUrl) {
    await postToResponseUrl(responseUrl, {
      response_type: "ephemeral",
      text,
      replace_original: false,
    });
    return;
  }

  if (channelId.startsWith("D")) {
    await client.chat.postMessage({
      channel: channelId,
      text,
    });
    return;
  }

  await client.chat.postEphemeral({
    channel: channelId,
    user: userId,
    text,
  });
}

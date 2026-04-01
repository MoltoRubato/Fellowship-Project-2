import type { EntryModalItem } from "../types.js";
import { ENTRY_MODAL_METADATA_MAX_CHARS } from "./constants";

export function truncatePlainText(text: string, max = 75) {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3))}...`;
}

type ProjectLike = {
  githubRepo: string;
  linearProjectName?: string | null;
};

function getIntegrationLabel(project: ProjectLike) {
  return project.linearProjectName ?? null;
}

export function formatProjectLabel(project?: ProjectLike | null) {
  if (!project) {
    return "No repo";
  }

  const integrationName = getIntegrationLabel(project);
  const suffix = integrationName ? ` | ${integrationName}` : "";
  return truncatePlainText(`${project.githubRepo}${suffix}`);
}

export function buildProjectOption(project: ProjectLike) {
  return {
    text: {
      type: "plain_text" as const,
      text: formatProjectLabel(project),
    },
    value: project.githubRepo,
  };
}

export function toEntryModalItem(entry: {
  id: string;
  displayId: number;
  displayDateKey: string;
  content: string;
  project?: ProjectLike | null;
}): EntryModalItem {
  return {
    entryId: entry.id,
    displayId: entry.displayId,
    displayDateKey: entry.displayDateKey,
    content: entry.content,
    repoLabel: entry.project ? formatProjectLabel(entry.project) : "No repo",
  };
}

export function buildEntryOption(entry: EntryModalItem) {
  const text = truncatePlainText(`#${entry.displayId} | ${entry.displayDateKey} | ${entry.repoLabel} | ${entry.content}`);
  return {
    text: {
      type: "plain_text" as const,
      text,
    },
    value: entry.entryId,
  };
}

export function buildEntryPreviewText(entry: EntryModalItem) {
  const quotedContent = entry.content
    .split("\n")
    .map((line) => `>${line}`)
    .join("\n");

  return `*Selected entry*\n*#${entry.displayId}* • ${entry.displayDateKey} • ${entry.repoLabel}\n${quotedContent}`;
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
        entryId?: unknown;
        displayId?: unknown;
        displayDateKey?: unknown;
        content?: unknown;
        repoLabel?: unknown;
      };
      const entryId = typeof candidate.entryId === "string" ? candidate.entryId : "";
      const displayId = Number(candidate.displayId);
      const displayDateKey = typeof candidate.displayDateKey === "string" ? candidate.displayDateKey : "";
      const content = typeof candidate.content === "string" ? candidate.content : "";
      const repoLabel = typeof candidate.repoLabel === "string" ? candidate.repoLabel : "No repo";

      if (!entryId || !Number.isInteger(displayId) || displayId <= 0 || !displayDateKey || !content.trim()) {
        return null;
      }

      return {
        entryId,
        displayId,
        displayDateKey,
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
  selectedEntryId: string;
  entries: EntryModalItem[];
}) {
  const baseMetadata = {
    channelId: input.channelId,
    teamId: input.teamId,
    responseUrl: input.responseUrl,
    selectedEntryId: input.selectedEntryId,
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

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
  displayId: number;
  content: string;
  project?: ProjectLike | null;
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

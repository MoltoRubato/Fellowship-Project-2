import { isRepoLike, normalizeRepo, normalizeRepos } from "@/server/services/standup";

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
  const parts = rawText
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  let period: "today" | "week" = "today";
  const repos: string[] = [];

  for (const part of parts) {
    if (part.toLowerCase() === "week") {
      period = "week";
      continue;
    }

    const normalizedRepo = normalizeRepo(part);
    if (normalizedRepo) {
      repos.push(normalizedRepo);
    }
  }

  return {
    repos: normalizeRepos(repos),
    period,
  };
}

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function isRepoLike(value?: string | null) {
  return Boolean(value && REPO_PATTERN.test(value.trim()));
}

export function normalizeRepo(value?: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "");
  return isRepoLike(normalized) ? normalized.toLowerCase() : null;
}

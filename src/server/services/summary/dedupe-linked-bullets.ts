const BULLET_LINE_PATTERN = /^\s*(?:[-•]\s+|\d+[.)]\s+)/;
const LINK_TOKEN_PATTERN = /<https?:\/\/[^|>]+\|[^>]+>|https?:\/\/\S+/gi;
const LINK_SUFFIX_PATTERN = /(?:\s-\s(?:<https?:\/\/[^|>]+\|[^>]+>|https?:\/\/\S+|Link))+$/gi;
const REF_PATTERN = /\s*\[ref:[a-z0-9_]+\]/gi;
const IDENTIFIER_PATTERN = /\b[A-Z]{2,}-\d+\b/;
const STATUS_PATTERN = /\b(moved to|in progress|done|completed|blocked|review)\b/i;

function extractUrls(line: string) {
  const urls: string[] = [];
  for (const match of line.matchAll(LINK_TOKEN_PATTERN)) {
    const token = match[0]?.trim();
    if (!token) {
      continue;
    }

    if (token.startsWith("<")) {
      const url = token.slice(1).split("|")[0]?.trim();
      if (url && !urls.includes(url)) {
        urls.push(url);
      }
      continue;
    }

    if (!urls.includes(token)) {
      urls.push(token);
    }
  }

  return urls;
}

function stripLinkArtifacts(line: string) {
  return line
    .replace(REF_PATTERN, "")
    .replace(LINK_SUFFIX_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreLine(line: string) {
  const stripped = stripLinkArtifacts(line);
  const text = stripped.replace(BULLET_LINE_PATTERN, "").trim();
  if (!text) {
    return 0;
  }

  let score = Math.min(text.length, 140);

  if (IDENTIFIER_PATTERN.test(text)) {
    score += 20;
  }

  if (STATUS_PATTERN.test(text)) {
    score += 12;
  }

  if (/[(:-]/.test(text)) {
    score += 4;
  }

  return score;
}

export function dedupeLinkedBulletLines(lines: string[]) {
  const removed = new Set<number>();
  const bestByUrl = new Map<string, { index: number; score: number }>();

  lines.forEach((line, index) => {
    if (!BULLET_LINE_PATTERN.test(line.trim())) {
      return;
    }

    const urls = extractUrls(line);
    if (urls.length !== 1) {
      return;
    }

    const url = urls[0]!;
    const score = scoreLine(line);
    const previous = bestByUrl.get(url);

    if (!previous) {
      bestByUrl.set(url, { index, score });
      return;
    }

    if (score > previous.score) {
      removed.add(previous.index);
      bestByUrl.set(url, { index, score });
      return;
    }

    removed.add(index);
  });

  return lines.filter((_, index) => !removed.has(index));
}

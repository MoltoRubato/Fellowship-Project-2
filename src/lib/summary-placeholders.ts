const PLACEHOLDER_TOKEN = "(?:x|y|z|n)";
const MEASUREMENT_UNIT =
  "(?:%|percent(?:age)?|ms|millisecond(?:s)?|s|sec(?:ond)?s?|m(?:in(?:ute)?s?)?|h(?:our)?s?|kb|mb|gb|tb|bytes?|rows?|files?|items?|records?|queries?|requests?|users?|tickets?|issues?|projects?|repos?)";

const PLACEHOLDER_VALUE_PATTERN = new RegExp(
  [
    `\\b${PLACEHOLDER_TOKEN}\\b(?=\\s*(?:${MEASUREMENT_UNIT}|to\\b|->|~|-))`,
    `\\b(?:from|to|by|at|under|over|around|about|down to|up to)\\s+${PLACEHOLDER_TOKEN}\\b`,
    "please specify",
  ].join("|"),
  "i",
);

const RANGE_PLACEHOLDER_PATTERN = new RegExp(
  `\\bfrom\\s+${PLACEHOLDER_TOKEN}\\b(?:\\s*(?:${MEASUREMENT_UNIT}))?\\s+(?:to|->|~|-)\\s+${PLACEHOLDER_TOKEN}\\b(?:\\s*(?:${MEASUREMENT_UNIT}))?`,
  "gi",
);

const MEASURED_PLACEHOLDER_PATTERN = new RegExp(
  `\\b${PLACEHOLDER_TOKEN}\\b\\s*(?:${MEASUREMENT_UNIT})`,
  "gi",
);

const CONNECTED_PLACEHOLDER_PATTERN = new RegExp(
  `\\b(?:by|from|to|at|under|over|around|about|down to|up to)\\s+${PLACEHOLDER_TOKEN}\\b(?:\\s*(?:${MEASUREMENT_UNIT}))?`,
  "gi",
);

const BARE_PLACEHOLDER_PATTERN = new RegExp(`\\b${PLACEHOLDER_TOKEN}\\b`, "gi");

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function cleanupSentence(value: string) {
  return normalizeWhitespace(
    value
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/\(\s*\)/g, "")
      .replace(/\s+-\s*$/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+\./g, "."),
  );
}

function looksLikeFullReplacement(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  const wordCount = trimmed.split(/\s+/).length;
  return wordCount >= 5 || /\b(from|to|reduced|improved|sped|cut|raised|dropped|trimmed)\b/i.test(trimmed);
}

export function containsSummaryPlaceholderValue(value: string) {
  return PLACEHOLDER_VALUE_PATTERN.test(value);
}

export function optionNeedsActualValue(option: string) {
  return containsSummaryPlaceholderValue(option);
}

export function applyCustomValueToPlaceholderOption(option: string, customValue: string) {
  const trimmedCustomValue = normalizeWhitespace(customValue);
  if (!trimmedCustomValue) {
    return option;
  }

  if (looksLikeFullReplacement(trimmedCustomValue)) {
    return trimmedCustomValue;
  }

  const substituted = option
    .replace(RANGE_PLACEHOLDER_PATTERN, trimmedCustomValue)
    .replace(MEASURED_PLACEHOLDER_PATTERN, trimmedCustomValue)
    .replace(CONNECTED_PLACEHOLDER_PATTERN, (match) => {
      const prefixMatch = match.match(/^(by|from|to|at|under|over|around|about|down to|up to)\b/i);
      const prefix = prefixMatch?.[0]?.trim();
      return prefix ? `${prefix} ${trimmedCustomValue}` : trimmedCustomValue;
    })
    .replace(BARE_PLACEHOLDER_PATTERN, trimmedCustomValue);

  return cleanupSentence(substituted);
}

export function stripPlaceholderPhrases(value: string) {
  const cleaned = value
    .replace(RANGE_PLACEHOLDER_PATTERN, "")
    .replace(CONNECTED_PLACEHOLDER_PATTERN, "")
    .replace(MEASURED_PLACEHOLDER_PATTERN, "")
    .replace(BARE_PLACEHOLDER_PATTERN, "")
    .replace(/\bplease specify\b/gi, "")
    .replace(/\s{2,}/g, " ");

  return cleanupSentence(cleaned);
}

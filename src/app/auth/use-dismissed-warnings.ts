"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "standup-dashboard-dismissed-warnings";

type ProviderKey = "github" | "linear";

type DismissedWarningsState = {
  github: string | null;
  linear: string | null;
};

const EMPTY_STATE: DismissedWarningsState = {
  github: null,
  linear: null,
};

function parseStoredWarnings(value: string | null): DismissedWarningsState {
  if (!value) {
    return EMPTY_STATE;
  }

  try {
    const parsed = JSON.parse(value) as Partial<DismissedWarningsState>;
    return {
      github: typeof parsed.github === "string" ? parsed.github : null,
      linear: typeof parsed.linear === "string" ? parsed.linear : null,
    };
  } catch {
    return EMPTY_STATE;
  }
}

export function useDismissedWarnings(input: {
  githubWarning: string | null;
  linearWarning: string | null;
}) {
  const [dismissedWarnings, setDismissedWarnings] = useState<DismissedWarningsState>(EMPTY_STATE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDismissedWarnings(parseStoredWarnings(window.localStorage.getItem(STORAGE_KEY)));
    setReady(true);
  }, []);

  function dismissWarning(provider: ProviderKey, warning: string | null) {
    if (!warning) {
      return;
    }

    setDismissedWarnings((current) => {
      const next = {
        ...current,
        [provider]: warning,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  const visibleWarnings = useMemo(
    () => ({
      github:
        ready && input.githubWarning && dismissedWarnings.github !== input.githubWarning
          ? input.githubWarning
          : null,
      linear:
        ready && input.linearWarning && dismissedWarnings.linear !== input.linearWarning
          ? input.linearWarning
          : null,
    }),
    [dismissedWarnings.github, dismissedWarnings.linear, input.githubWarning, input.linearWarning, ready],
  );

  return {
    dismissWarning,
    visibleWarnings,
  };
}

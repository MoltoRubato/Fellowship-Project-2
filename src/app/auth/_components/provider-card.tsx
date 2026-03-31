"use client";

import type { ReactNode } from "react";

export function ProviderCard(props: {
  title: string;
  loading?: boolean;
  connected: boolean;
  username: string | null;
  warning: string | null;
  onDismissWarning?: () => void;
  action: ReactNode;
}) {
  const statusLabel = props.loading
    ? "Checking connection"
    : props.connected
      ? "Connected"
      : "Not connected";

  const detailLabel = props.loading
    ? "Loading connection details..."
    : props.connected
      ? props.username
        ? `Connected as ${props.username}`
        : "Account connected"
      : "No account connected";

  return (
    <article
      className="rounded-xl border border-[color:var(--border)] bg-[var(--card-bg)] p-5"
      style={{ boxShadow: "var(--panel-shadow)" }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor: props.loading
                  ? "var(--badge-muted-text)"
                  : props.connected
                    ? "var(--success)"
                    : "var(--badge-muted-text)",
              }}
            />
            <span>{statusLabel}</span>
          </div>
          <h2 className="mt-2 text-lg font-semibold">{props.title}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {detailLabel}
          </p>
        </div>
        <div className="shrink-0">{props.action}</div>
      </div>

      {props.warning ? (
        <div
          className="mt-4 flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
          style={{
            borderColor: "var(--warning-soft)",
            backgroundColor: "var(--warning-soft)",
            color: "var(--warning)",
          }}
        >
          <span>{props.warning}</span>
          {props.onDismissWarning ? (
            <button
              type="button"
              aria-label={`Dismiss ${props.title} warning`}
              className="shrink-0 text-current opacity-80 transition-opacity hover:opacity-100"
              onClick={props.onDismissWarning}
            >
              <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.8"
                />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

"use client";

import type { ReactNode } from "react";

export function ProviderCard(props: {
  title: string;
  connected: boolean;
  username: string | null;
  warning: string | null;
  action: ReactNode;
}) {
  return (
    <article
      className="rounded-xl border border-[color:var(--border)] bg-[var(--card-bg)] p-5"
      style={{ boxShadow: "var(--panel-shadow)" }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor: props.connected ? "var(--success)" : "var(--badge-muted-text)",
              }}
            />
            <span>{props.connected ? "Connected" : "Not connected"}</span>
          </div>
          <h2 className="mt-2 text-2xl font-semibold">{props.title}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {props.connected
              ? props.username
                ? `Connected as ${props.username}`
                : "Account connected"
              : "No account connected"}
          </p>
        </div>
        {props.action}
      </div>

      {props.warning ? (
        <div
          className="mt-4 rounded-lg border px-3 py-2 text-sm"
          style={{
            borderColor: "var(--warning-soft)",
            backgroundColor: "var(--warning-soft)",
            color: "var(--warning)",
          }}
        >
          {props.warning}
        </div>
      ) : null}
    </article>
  );
}

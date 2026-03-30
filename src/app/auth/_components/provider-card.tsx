"use client";

import type { ReactNode } from "react";

export function ProviderCard(props: {
  title: string;
  description: string;
  connected: boolean;
  username: string | null;
  warning: string | null;
  action: ReactNode;
  detail: ReactNode;
}) {
  return (
    <article className="rounded-[2rem] border border-white/10 bg-[var(--bg-elevated)] p-6 shadow-xl shadow-black/20 backdrop-blur sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold">{props.title}</h2>
            <span
              className={`rounded-full px-3 py-1 text-xs ${
                props.connected
                  ? "border border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
                  : "border border-white/10 bg-white/5 text-[var(--muted)]"
              }`}
            >
              {props.connected ? "Connected" : "Not connected"}
            </span>
          </div>
          <p className="mt-2 text-sm leading-7 text-[var(--muted)]">{props.description}</p>
        </div>
        {props.action}
      </div>

      <div className="mt-5">{props.detail}</div>

      {props.warning ? (
        <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
          {props.warning}
        </div>
      ) : null}
    </article>
  );
}

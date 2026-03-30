"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { signIn, useSession } from "next-auth/react";

interface AccountSummary {
  provider: "github" | "linear";
  username: string | null;
  scope: string | null;
}

interface DashboardProject {
  id: string;
  githubRepo: string;
  githubRepoUrl: string | null;
  linearProjectId: string | null;
  linearTeamId: string | null;
  linearProjectName: string | null;
  lastUsedAt: string | null;
  isDefault: boolean;
}

interface GithubRepo {
  id: string;
  nameWithOwner: string;
  url: string;
  isPrivate: boolean;
  visibility: string;
}

interface LinearProjectOption {
  id: string;
  name: string;
  teamId: string;
  teamKey: string;
  teamName: string;
}

interface DashboardState {
  user: {
    slackUserId: string;
    defaultProjectId: string | null;
  };
  accounts: AccountSummary[];
  projects: DashboardProject[];
  github: {
    connected: boolean;
    username: string | null;
    scopes: string[];
    permissionWarning: string | null;
    repos: GithubRepo[];
  };
  linear: {
    connected: boolean;
    username: string | null;
    permissionWarning: string | null;
    projects: LinearProjectOption[];
  };
}

const buttonBase =
  "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-sky-300/50";

export default function AuthPage() {
  const { status } = useSession();
  const [paramsLoaded, setParamsLoaded] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [connected, setConnected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [attemptedToken, setAttemptedToken] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [draftMappings, setDraftMappings] = useState<Record<string, string>>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token"));
    setConnected(params.get("connected"));
    setError(params.get("error"));
    setParamsLoaded(true);
  }, []);

  useEffect(() => {
    if (!paramsLoaded || !token || status !== "unauthenticated" || signingIn || attemptedToken === token) {
      return;
    }

    setAttemptedToken(token);
    setSigningIn(true);
    signIn("credentials", { token, redirect: false }).then((result) => {
      if (result?.error) {
        setAuthError("That auth link has expired. Run /auth in Slack to get a fresh one.");
      }
      setSigningIn(false);
    });
  }, [attemptedToken, paramsLoaded, signingIn, status, token]);

  useEffect(() => {
    if (error) {
      setAuthError("The connection flow did not finish cleanly. Please try again from this page.");
    }
  }, [error]);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    setLoadingDashboard(true);
    fetch("/api/oauth/status")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to load dashboard");
        }
        return (await response.json()) as DashboardState;
      })
      .then((data) => {
        setDashboard(data);
        setDraftMappings(
          Object.fromEntries(
            data.projects.map((project) => [project.id, project.linearProjectId ?? ""]),
          ),
        );
      })
      .catch(() => {
        setAuthError("We could not load your connection status. Refresh the page and try again.");
      })
      .finally(() => {
        setLoadingDashboard(false);
      });
  }, [status, connected]);

  const linearProjectLookup = useMemo(
    () => new Map((dashboard?.linear.projects ?? []).map((project) => [project.id, project])),
    [dashboard?.linear.projects],
  );

  async function reloadDashboard() {
    setLoadingDashboard(true);
    const response = await fetch("/api/oauth/status");
    const data = (await response.json()) as DashboardState;
    setDashboard(data);
    setDraftMappings(
      Object.fromEntries(data.projects.map((project) => [project.id, project.linearProjectId ?? ""])),
    );
    setLoadingDashboard(false);
  }

  async function disconnect(provider: "github" | "linear") {
    setBusyAction(`disconnect:${provider}`);
    await fetch(`/api/oauth/disconnect?provider=${provider}`, { method: "POST" });
    await reloadDashboard();
    setBusyAction(null);
  }

  async function makeDefault(projectId: string) {
    setBusyAction(`default:${projectId}`);
    await fetch("/api/projects/default", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    await reloadDashboard();
    setBusyAction(null);
  }

  async function saveLinearMapping(projectId: string) {
    const selectedId = draftMappings[projectId] ?? "";
    const selected = linearProjectLookup.get(selectedId);

    setBusyAction(`linear:${projectId}`);
    await fetch("/api/projects/link-linear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        linearProjectId: selected?.id ?? null,
        linearTeamId: selected?.teamId ?? null,
        linearProjectName: selected ? `${selected.teamKey} · ${selected.name}` : null,
      }),
    });
    await reloadDashboard();
    setBusyAction(null);
  }

  if (!paramsLoaded || status === "loading" || (token && signingIn)) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="rounded-[2rem] border border-white/10 bg-[var(--panel)] px-8 py-10 text-center shadow-2xl shadow-sky-950/30 backdrop-blur">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-sky-200/20 border-t-sky-300" />
          <p className="text-sm text-[var(--muted)]">Authenticating your Slack handoff...</p>
        </div>
      </main>
    );
  }

  if (authError || (status === "unauthenticated" && !token)) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <section className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-[var(--bg-elevated)] p-8 shadow-2xl shadow-black/25 backdrop-blur">
          <p className="mb-3 text-sm uppercase tracking-[0.3em] text-sky-200/80">Standup Bot</p>
          <h1 className="text-3xl font-semibold">Connect from Slack first</h1>
          <p className="mt-4 text-base leading-7 text-[var(--muted)]">
            {authError ?? "Run /auth in Slack and open the secure link it sends you in DM."}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-10 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="rounded-[2rem] border border-white/10 bg-[var(--bg-elevated)] p-6 shadow-2xl shadow-black/20 backdrop-blur sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm uppercase tracking-[0.3em] text-sky-200/80">Standup Bot Dashboard</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight">Link accounts and shape your standup context</h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--muted)]">
                This page is intentionally narrow: connect GitHub and Linear, inspect what each OAuth account can see,
                pick the default repo Slack commands should use, and map Linear projects onto GitHub repos.
              </p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-950/50 px-5 py-4 text-sm text-[var(--muted)]">
              <div className="font-medium text-white">Slack identity</div>
              <div className="mt-1">{dashboard?.user.slackUserId ?? "Loading..."}</div>
              <div className="mt-2 text-xs text-sky-200/80">Reminders run at 09:00 and 17:00 UTC for active users.</div>
            </div>
          </div>

          {connected ? (
            <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
              {connected === "github" ? "GitHub" : "Linear"} connected successfully.
            </div>
          ) : null}

          {loadingDashboard ? (
            <div className="mt-6 text-sm text-[var(--muted)]">Loading integrations and visible projects...</div>
          ) : null}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <ProviderCard
            title="GitHub"
            description="Read commits, PRs, and visible repos."
            connected={Boolean(dashboard?.github.connected)}
            username={dashboard?.github.username ?? null}
            warning={dashboard?.github.permissionWarning ?? null}
            action={
              dashboard?.github.connected ? (
                <button
                  className={`${buttonBase} border border-rose-400/25 bg-rose-400/10 text-rose-100 hover:bg-rose-400/20`}
                  disabled={busyAction === "disconnect:github"}
                  onClick={() => disconnect("github")}
                >
                  Disconnect
                </button>
              ) : (
                <a className={`${buttonBase} bg-white text-slate-950 hover:bg-slate-100`} href="/api/oauth/github">
                  Connect GitHub
                </a>
              )
            }
            detail={
              <div className="space-y-3">
                <p className="text-sm text-[var(--muted)]">
                  {dashboard?.github.connected
                    ? `Connected as @${dashboard.github.username}`
                    : "GitHub is the source of truth for repos. Connect it before wiring Linear projects."}
                </p>
                {dashboard?.github.scopes.length ? (
                  <div className="flex flex-wrap gap-2">
                    {dashboard.github.scopes.map((scope) => (
                      <span
                        key={scope}
                        className="rounded-full border border-sky-300/15 bg-sky-300/10 px-3 py-1 text-xs text-sky-100"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                ) : null}
                <p className="text-xs text-[var(--muted)]">
                  Visible repos: <span className="text-white">{dashboard?.github.repos.length ?? 0}</span>
                </p>
              </div>
            }
          />

          <ProviderCard
            title="Linear"
            description="Read assigned issue updates for mapped projects."
            connected={Boolean(dashboard?.linear.connected)}
            username={dashboard?.linear.username ?? null}
            warning={dashboard?.linear.permissionWarning ?? null}
            action={
              dashboard?.linear.connected ? (
                <button
                  className={`${buttonBase} border border-rose-400/25 bg-rose-400/10 text-rose-100 hover:bg-rose-400/20`}
                  disabled={busyAction === "disconnect:linear"}
                  onClick={() => disconnect("linear")}
                >
                  Disconnect
                </button>
              ) : (
                <a className={`${buttonBase} bg-sky-400 text-slate-950 hover:bg-sky-300`} href="/api/oauth/linear">
                  Connect Linear
                </a>
              )
            }
            detail={
              <div className="space-y-3">
                <p className="text-sm text-[var(--muted)]">
                  {dashboard?.linear.connected
                    ? `Connected as ${dashboard.linear.username ?? "your Linear account"}`
                    : "Linear projects become available for mapping once the account is connected."}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  Visible Linear projects: <span className="text-white">{dashboard?.linear.projects.length ?? 0}</span>
                </p>
              </div>
            }
          />
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-[var(--bg-elevated)] p-6 shadow-xl shadow-black/20 backdrop-blur sm:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Project routing</h2>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-[var(--muted)]">
                Each GitHub repo becomes a project. Set one as the default so `/did`, `/blocker`, `/edit`,
                `/delete`, and `/summarise` can omit the repo name when you are working in the same place all week.
              </p>
            </div>
            <div className="text-sm text-[var(--muted)]">
              {dashboard?.projects.length ?? 0} tracked repo{dashboard?.projects.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className="mt-6 grid gap-4">
            {dashboard?.projects.length ? (
              dashboard.projects.map((project) => (
                <article
                  key={project.id}
                  className="rounded-3xl border border-white/10 bg-slate-950/40 p-5"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <a
                          className="text-lg font-medium text-white underline decoration-sky-300/40 underline-offset-4"
                          href={project.githubRepoUrl ?? `https://github.com/${project.githubRepo}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {project.githubRepo}
                        </a>
                        {project.isDefault ? (
                          <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs text-emerald-100">
                            Default repo
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm text-[var(--muted)]">
                        {project.linearProjectName
                          ? `Mapped to ${project.linearProjectName}`
                          : dashboard?.linear.connected
                            ? "No Linear project mapped yet."
                            : "Connect Linear if you want issue updates in summaries."}
                      </p>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <button
                        className={`${buttonBase} border border-white/10 bg-white/5 text-white hover:bg-white/10`}
                        disabled={project.isDefault || busyAction === `default:${project.id}`}
                        onClick={() => makeDefault(project.id)}
                      >
                        {project.isDefault ? "Default" : "Make default"}
                      </button>

                      <div className="flex flex-col gap-2 sm:min-w-72">
                        <select
                          className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-2 text-sm text-white"
                          disabled={!dashboard?.linear.connected}
                          value={draftMappings[project.id] ?? ""}
                          onChange={(event) =>
                            setDraftMappings((current) => ({
                              ...current,
                              [project.id]: event.target.value,
                            }))
                          }
                        >
                          <option value="">No Linear project</option>
                          {(dashboard?.linear.projects ?? []).map((linearProject) => (
                            <option key={linearProject.id} value={linearProject.id}>
                              {linearProject.teamKey} · {linearProject.name}
                            </option>
                          ))}
                        </select>
                        <button
                          className={`${buttonBase} border border-sky-300/20 bg-sky-300/10 text-sky-50 hover:bg-sky-300/20`}
                          disabled={!dashboard?.linear.connected || busyAction === `linear:${project.id}`}
                          onClick={() => saveLinearMapping(project.id)}
                        >
                          Save Linear mapping
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/40 p-8 text-sm text-[var(--muted)]">
                Connect GitHub to pull the repos this account can see. Those repos will appear here automatically.
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-[2rem] border border-white/10 bg-[var(--bg-elevated)] p-6 shadow-xl shadow-black/20 backdrop-blur sm:p-8">
            <h2 className="text-2xl font-semibold">Visible GitHub repos</h2>
            <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
              This is what the connected GitHub OAuth account is currently exposing to the app.
            </p>

            <div className="mt-6 grid gap-3">
              {(dashboard?.github.repos ?? []).length ? (
                dashboard?.github.repos.map((repo) => (
                  <a
                    key={repo.id}
                    href={repo.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm hover:border-sky-300/30"
                  >
                    <span>{repo.nameWithOwner}</span>
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-[var(--muted)]">
                      {repo.visibility}
                    </span>
                  </a>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/40 p-5 text-sm text-[var(--muted)]">
                  No repos available yet.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-[var(--bg-elevated)] p-6 shadow-xl shadow-black/20 backdrop-blur sm:p-8">
            <h2 className="text-2xl font-semibold">Command defaults</h2>
            <div className="mt-4 space-y-4 text-sm leading-7 text-[var(--muted)]">
              <p>`/did [repo] message` logs work updates.</p>
              <p>`/blocker [repo] message` logs blockers that stay active until deleted.</p>
              <p>`/edit [repo] entryId new text` updates a previous manual log.</p>
              <p>`/delete [repo] entryId` resolves or removes a previous manual log.</p>
              <p>`/summarise [repo]` or `/summarise week` generates the Slack-ready summary format.</p>
              <p>`/auth` sends a fresh dashboard link back to your Slack DM.</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function ProviderCard(props: {
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

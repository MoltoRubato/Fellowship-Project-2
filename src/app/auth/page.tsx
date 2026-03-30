"use client";

import { useEffect, useMemo, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { trpc } from "@/trpc/react";
import { ProviderCard } from "./_components/provider-card";
import { ProjectRoutingSection } from "./_components/project-routing-section";
import { GithubReposSection } from "./_components/github-repos-section";
import { CommandDefaultsSection } from "./_components/command-defaults-section";

const buttonBase =
  "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-sky-300/50";

export default function AuthPage() {
  const { status } = useSession();
  const [paramsLoaded, setParamsLoaded] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [connected, setConnected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [attemptedToken, setAttemptedToken] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [draftMappings, setDraftMappings] = useState<Record<string, string>>({});

  const isAuthenticated = status === "authenticated";

  const dashboardQuery = trpc.dashboard.status.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchOnWindowFocus: false,
  });
  const dashboard = dashboardQuery.data ?? null;
  const loadingDashboard = dashboardQuery.isLoading && isAuthenticated;

  const disconnectMutation = trpc.user.disconnectAccount.useMutation({
    onSuccess: () => dashboardQuery.refetch(),
  });
  const linkLinearMutation = trpc.user.linkIntegration.useMutation({
    onSuccess: () => dashboardQuery.refetch(),
  });

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
    if (connected && isAuthenticated) {
      dashboardQuery.refetch();
    }
  }, [connected, isAuthenticated]);

  useEffect(() => {
    if (dashboardQuery.error) {
      setAuthError("We could not load your connection status. Refresh the page and try again.");
    }
  }, [dashboardQuery.error]);

  useEffect(() => {
    if (dashboard) {
      setDraftMappings(
        Object.fromEntries(
          dashboard.projects.map((project) => [project.id, project.linearProjectId ?? ""]),
        ),
      );
    }
  }, [dashboard]);

  const linearProjectLookup = useMemo(
    () => new Map((dashboard?.linear.projects ?? []).map((project) => [project.id, project])),
    [dashboard?.linear.projects],
  );

  async function disconnect(provider: "github" | "linear") {
    setBusyAction(`disconnect:${provider}`);
    await disconnectMutation.mutateAsync({ provider });
    setBusyAction(null);
  }

  async function saveLinearMapping(projectId: string) {
    const selectedId = draftMappings[projectId] ?? "";
    const selected = linearProjectLookup.get(selectedId);

    setBusyAction(`linear:${projectId}`);
    await linkLinearMutation.mutateAsync({
      projectId,
      type: "linear",
      externalId: selected?.id ?? null,
      externalTeamId: selected?.teamId ?? null,
      externalName: selected ? `${selected.teamKey} · ${selected.name}` : null,
    });
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

        <ProjectRoutingSection
          projects={dashboard?.projects ?? []}
          linearConnected={Boolean(dashboard?.linear.connected)}
          linearProjects={dashboard?.linear.projects ?? []}
          draftMappings={draftMappings}
          busyAction={busyAction}
          onDraftChange={(projectId, value) =>
            setDraftMappings((current) => ({ ...current, [projectId]: value }))
          }
          onSave={saveLinearMapping}
        />

        <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <GithubReposSection repos={dashboard?.github.repos ?? []} />
          <CommandDefaultsSection />
        </section>
      </div>
    </main>
  );
}

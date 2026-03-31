"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { trpc } from "@/trpc/react";
import { ProviderCard } from "./_components/provider-card";
import { ProjectRoutingSection } from "./_components/project-routing-section";
import { ThemeToggle } from "./_components/theme-toggle";

const buttonBase =
  "inline-flex min-w-[144px] items-center justify-center whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-60";

const primaryButtonClass =
  `${buttonBase} bg-[var(--accent)] text-white hover:bg-[var(--accent-strong)]`;

const dangerButtonClass =
  `${buttonBase} border border-[color:var(--border)] bg-transparent text-[var(--danger)] hover:bg-[var(--danger-soft)]`;

const loadingActionClass =
  "h-10 min-w-[144px] rounded-lg border border-[color:var(--border)] bg-[var(--input-bg)]";

const THEME_STORAGE_KEY = "standup-dashboard-theme";

type ThemeMode = "light" | "dark";

function applyTheme(theme: ThemeMode) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.classList.toggle("light", theme === "light");
}

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
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [themeReady, setThemeReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissedWarnings, setDismissedWarnings] = useState<{
    github: string | null;
    linear: string | null;
  }>({
    github: null,
    linear: null,
  });

  const isAuthenticated = status === "authenticated";

  const dashboardQuery = trpc.dashboard.status.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchOnWindowFocus: false,
  });
  const dashboard = dashboardQuery.data ?? null;
  const isInitialDashboardLoad = isAuthenticated && !dashboard && dashboardQuery.isLoading;

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
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const initialTheme =
      storedTheme === "light" || storedTheme === "dark"
        ? storedTheme
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";

    setTheme(initialTheme);
    applyTheme(initialTheme);
    setThemeReady(true);
  }, []);

  useEffect(() => {
    if (!themeReady) {
      return;
    }

    applyTheme(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme, themeReady]);

  useEffect(() => {
    if (!paramsLoaded || !token || status === "loading" || signingIn || attemptedToken === token) {
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
    if (dashboardQuery.error) {
      setAuthError("We could not load your connection status. Refresh the page and try again.");
    }
  }, [dashboardQuery.error]);

  useEffect(() => {
    if (!connected) {
      return;
    }

    setNotice(`${connected === "github" ? "GitHub" : "Linear"} connected.`);
  }, [connected]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setNotice(null);
    }, 4000);

    return () => window.clearTimeout(timeout);
  }, [notice]);

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

  const githubWarning = dashboard?.github.permissionWarning ?? null;
  const linearWarning = dashboard?.linear.permissionWarning ?? null;
  const visibleGithubWarning =
    githubWarning && dismissedWarnings.github !== githubWarning ? githubWarning : null;
  const visibleLinearWarning =
    linearWarning && dismissedWarnings.linear !== linearWarning ? linearWarning : null;

  async function disconnect(provider: "github" | "linear") {
    setBusyAction(`disconnect:${provider}`);
    try {
      await disconnectMutation.mutateAsync({ provider });
    } finally {
      setBusyAction(null);
    }
  }

  async function saveLinearMapping(projectId: string) {
    const selectedId = draftMappings[projectId] ?? "";
    const selected = linearProjectLookup.get(selectedId);

    setBusyAction(`linear:${projectId}`);
    try {
      await linkLinearMutation.mutateAsync({
        projectId,
        type: "linear",
        externalId: selected?.id ?? null,
        externalTeamId: selected?.teamId ?? null,
        externalName: selected ? `${selected.teamKey} · ${selected.name}` : null,
      });
    } finally {
      setBusyAction(null);
    }
  }

  if (!paramsLoaded || status === "loading" || (token && signingIn)) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div
          className="rounded-xl border border-[color:var(--border)] bg-[var(--panel)] px-6 py-8 text-center"
          style={{ boxShadow: "var(--panel-shadow)" }}
        >
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-[color:var(--border)] border-t-[color:var(--accent)]" />
          <p className="text-sm text-[var(--muted)]">Authenticating your Slack handoff...</p>
        </div>
      </main>
    );
  }

  if (authError || (status === "unauthenticated" && !token)) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <section
          className="w-full max-w-md rounded-xl border border-[color:var(--border)] bg-[var(--panel)] p-6"
          style={{ boxShadow: "var(--panel-shadow)" }}
        >
          <h1 className="text-2xl font-semibold">Connect from Slack first</h1>
          <p className="mt-3 text-sm text-[var(--muted)]">
            {authError ?? "Run /auth in Slack and open the secure link it sends you in DM."}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        <section
          className="rounded-xl border border-[color:var(--border)] bg-[var(--panel)] p-5"
          style={{ boxShadow: "var(--panel-shadow)" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-[color:var(--border)]">
                <Image
                  alt="Standup Bot icon"
                  className="object-cover"
                  fill
                  priority
                  sizes="56px"
                  src="/standup-bot-icon.png"
                />
              </div>

              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--muted)]">Standup Bot</p>
                <h1 className="mt-1 text-xl font-semibold">Connections</h1>
                <p className="mt-1 text-sm text-[var(--muted)]">
                Connect GitHub and Linear, then map repos to the right projects.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
                  <span>
                    {dashboard?.user.slackDisplayName
                      ? `Connected through Slack as ${dashboard.user.slackDisplayName}`
                      : "Connected through Slack"}
                  </span>
                  {dashboard?.user.slackUserId ? (
                    <span className="rounded-md bg-[var(--badge-muted-bg)] px-2 py-1 text-xs text-[var(--badge-muted-text)]">
                      ID {dashboard.user.slackUserId}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <ThemeToggle
              isDark={theme === "dark"}
              onToggle={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            />
          </div>

          {notice ? (
            <div
              className="mt-4 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
              style={{
                borderColor: "var(--success-soft)",
                backgroundColor: "var(--success-soft)",
                color: "var(--success)",
              }}
            >
              <span>{notice}</span>
              <button
                type="button"
                aria-label="Dismiss notification"
                className="text-current opacity-80 transition-opacity hover:opacity-100"
                onClick={() => setNotice(null)}
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
            </div>
          ) : null}

          {isInitialDashboardLoad ? (
            <p className="mt-3 text-sm text-[var(--muted)]">Loading connection status...</p>
          ) : null}
        </section>

        <section className="grid gap-5 md:grid-cols-2">
          <ProviderCard
            title="GitHub"
            loading={isInitialDashboardLoad}
            connected={Boolean(dashboard?.github.connected)}
            username={dashboard?.github.username ?? null}
            warning={visibleGithubWarning}
            onDismissWarning={() =>
              setDismissedWarnings((current) => ({ ...current, github: githubWarning }))
            }
            action={
              isInitialDashboardLoad ? (
                <div aria-hidden="true" className={loadingActionClass} />
              ) : dashboard?.github.connected ? (
                <button
                  className={dangerButtonClass}
                  disabled={busyAction === "disconnect:github"}
                  onClick={() => disconnect("github")}
                >
                  Disconnect
                </button>
              ) : (
                <a className={primaryButtonClass} href="/api/oauth/github">
                  Connect GitHub
                </a>
              )
            }
          />

          <ProviderCard
            title="Linear"
            loading={isInitialDashboardLoad}
            connected={Boolean(dashboard?.linear.connected)}
            username={dashboard?.linear.username ?? null}
            warning={visibleLinearWarning}
            onDismissWarning={() =>
              setDismissedWarnings((current) => ({ ...current, linear: linearWarning }))
            }
            action={
              isInitialDashboardLoad ? (
                <div aria-hidden="true" className={loadingActionClass} />
              ) : dashboard?.linear.connected ? (
                <button
                  className={dangerButtonClass}
                  disabled={busyAction === "disconnect:linear"}
                  onClick={() => disconnect("linear")}
                >
                  Disconnect
                </button>
              ) : (
                <a className={primaryButtonClass} href="/api/oauth/linear">
                  Connect Linear
                </a>
              )
            }
          />
        </section>

        {dashboard ? (
          <ProjectRoutingSection
            projects={dashboard.projects}
            linearConnected={Boolean(dashboard.linear.connected)}
            linearProjects={dashboard.linear.projects}
            githubRepos={dashboard.github.repos}
            draftMappings={draftMappings}
            busyAction={busyAction}
            onDraftChange={(projectId, value) =>
              setDraftMappings((current) => ({ ...current, [projectId]: value }))
            }
            onSave={saveLinearMapping}
          />
        ) : (
          <section
            className="rounded-xl border border-[color:var(--border)] bg-[var(--card-bg)] p-5"
            style={{ boxShadow: "var(--panel-shadow)" }}
          >
            <h2 className="text-lg font-semibold">Project Routing</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">Loading repo mappings...</p>
          </section>
        )}
      </div>
    </main>
  );
}

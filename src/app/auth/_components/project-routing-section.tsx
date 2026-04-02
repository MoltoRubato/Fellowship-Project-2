"use client";

import { useMemo, useState } from "react";

const buttonBase =
  "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-60";

const secondaryButtonClass =
  `${buttonBase} border border-[color:var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--card-hover)]`;

const primaryButtonClass =
  `${buttonBase} bg-[var(--accent)] text-white hover:bg-[var(--accent-strong)]`;

type ProjectSort = "recent" | "alpha-asc" | "alpha-desc";

function compareDateDesc(left?: string | Date | null, right?: string | Date | null) {
  const leftTime = left ? new Date(left).getTime() : 0;
  const rightTime = right ? new Date(right).getTime() : 0;
  return rightTime - leftTime;
}

interface ProjectRoutingProps {
  projects: Array<{
    id: string;
    githubRepo: string;
    githubRepoUrl: string | null;
    linearProjectName: string | null;
    githubRepoUpdatedAt?: string | Date | null;
    lastUsedAt?: string | Date | null;
  }>;
  linearConnected: boolean;
  linearProjects: Array<{
    id: string;
    name: string;
    teamKey: string;
  }>;
  githubRepos: Array<{
    id: string;
    nameWithOwner: string;
    url: string;
    visibility: string;
    isPrivate?: boolean;
    updatedAt?: string | null;
  }>;
  draftMappings: Record<string, string>;
  busyAction: string | null;
  onDraftChange: (projectId: string, value: string) => void;
  onSave: (projectId: string) => Promise<void> | void;
}

export function ProjectRoutingSection(props: ProjectRoutingProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [sort, setSort] = useState<ProjectSort>("recent");

  const githubRepoLookup = useMemo(
    () =>
      new Map(
        props.githubRepos.map((repo) => [
          repo.nameWithOwner.toLowerCase(),
          {
            url: repo.url,
            visibility: repo.visibility || (repo.isPrivate ? "private" : "public"),
            updatedAt: repo.updatedAt ?? null,
          },
        ]),
      ),
    [props.githubRepos],
  );

  const sortedProjects = useMemo(() => {
    return props.projects
      .slice()
      .sort((left, right) => {
        if (sort === "alpha-asc") {
          return left.githubRepo.localeCompare(right.githubRepo);
        }

        if (sort === "alpha-desc") {
          return right.githubRepo.localeCompare(left.githubRepo);
        }

        const leftRepo = githubRepoLookup.get(left.githubRepo.toLowerCase());
        const rightRepo = githubRepoLookup.get(right.githubRepo.toLowerCase());
        const updatedComparison = compareDateDesc(
          leftRepo?.updatedAt ?? left.githubRepoUpdatedAt ?? left.lastUsedAt,
          rightRepo?.updatedAt ?? right.githubRepoUpdatedAt ?? right.lastUsedAt,
        );

        if (updatedComparison !== 0) {
          return updatedComparison;
        }

        const lastUsedComparison = compareDateDesc(left.lastUsedAt, right.lastUsedAt);
        if (lastUsedComparison !== 0) {
          return lastUsedComparison;
        }

        return left.githubRepo.localeCompare(right.githubRepo);
      });
  }, [githubRepoLookup, props.projects, sort]);

  async function handleSave(projectId: string) {
    await props.onSave(projectId);
    setEditingProjectId(null);
  }

  return (
    <section
      className="auth-card-transition rounded-xl border border-[color:var(--border)] bg-[var(--card-bg)] hover:-translate-y-px hover:bg-[var(--card-hover)]"
      style={{ boxShadow: "var(--panel-shadow)" }}
    >
      <div className="flex items-center justify-between gap-4 px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <div>
            <h2 className="auth-title-stable text-lg font-semibold text-[var(--text)]">
              Project Routing
            </h2>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              {props.projects.length} repo{props.projects.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          {props.projects.length > 1 && isExpanded ? (
            <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
              <span className="whitespace-nowrap">Sort</span>
              <select
                className="rounded-lg border border-[color:var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
                value={sort}
                onChange={(event) => setSort(event.target.value as ProjectSort)}
              >
                <option value="recent">Most recent</option>
                <option value="alpha-asc">A to Z</option>
                <option value="alpha-desc">Z to A</option>
              </select>
            </label>
          ) : null}

          <button
            type="button"
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Collapse project routing" : "Expand project routing"}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[color:var(--border)] bg-[var(--card-bg)] text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--text)]"
            onClick={() => setIsExpanded((current) => !current)}
          >
            <svg
              aria-hidden="true"
              className={`h-5 w-5 text-[var(--muted)] transition-transform ${isExpanded ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                d="M9 6l6 6-6 6"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="auth-accordion border-t border-[color:var(--border)]" data-open={isExpanded}>
        <div className="auth-accordion-inner px-5 py-4">
          {props.projects.length ? (
            <div className="overflow-hidden rounded-xl border border-[color:var(--border)]">
              {sortedProjects.map((project, index) => {
                const repo = githubRepoLookup.get(project.githubRepo.toLowerCase());
                const isEditing = editingProjectId === project.id;

                return (
                  <div
                    key={project.id}
                    className={index === 0 ? "" : "border-t border-[color:var(--border)]"}
                  >
                    <div className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto] sm:items-center">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            className="truncate text-sm font-medium text-[var(--text)] hover:text-[var(--accent)]"
                            href={repo?.url ?? project.githubRepoUrl ?? `https://github.com/${project.githubRepo}`}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {project.githubRepo}
                          </a>
                          {repo?.visibility ? (
                            <span className="rounded-md bg-[var(--badge-muted-bg)] px-2 py-1 text-xs text-[var(--badge-muted-text)]">
                              {repo.visibility}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="text-sm text-[var(--muted)]">
                        {project.linearProjectName ?? "Not mapped"}
                      </div>

                      <button
                        type="button"
                        aria-label={`Edit mapping for ${project.githubRepo}`}
                        className={secondaryButtonClass}
                        onClick={() =>
                          setEditingProjectId((current) => (current === project.id ? null : project.id))
                        }
                      >
                        Edit
                      </button>
                    </div>

                    <div className="auth-accordion border-t border-[color:var(--border)] bg-[var(--input-bg)]" data-open={isEditing}>
                      <div className="auth-accordion-inner px-4 py-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                          <select
                            className="min-w-0 flex-1 rounded-lg border border-[color:var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
                            disabled={!props.linearConnected}
                            value={props.draftMappings[project.id] ?? ""}
                            onChange={(event) => props.onDraftChange(project.id, event.target.value)}
                          >
                            <option value="">No Linear project</option>
                            {props.linearProjects.map((linearProject) => (
                              <option key={linearProject.id} value={linearProject.id}>
                                {linearProject.teamKey} · {linearProject.name}
                              </option>
                            ))}
                          </select>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className={primaryButtonClass}
                              disabled={!props.linearConnected || props.busyAction === `linear:${project.id}`}
                              onClick={() => handleSave(project.id)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className={secondaryButtonClass}
                              onClick={() => setEditingProjectId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>

                        {!props.linearConnected ? (
                          <p className="mt-3 text-sm text-[var(--muted)]">
                            Connect Linear to edit repo mappings.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Connect GitHub to see your repos here.</p>
          )}
        </div>
      </div>
    </section>
  );
}

"use client";

const buttonBase =
  "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-sky-300/50";

interface ProjectRoutingProps {
  projects: Array<{
    id: string;
    githubRepo: string;
    githubRepoUrl: string | null;
    linearProjectName: string | null;
  }>;
  linearConnected: boolean;
  linearProjects: Array<{
    id: string;
    name: string;
    teamKey: string;
  }>;
  draftMappings: Record<string, string>;
  busyAction: string | null;
  onDraftChange: (projectId: string, value: string) => void;
  onSave: (projectId: string) => void;
}

export function ProjectRoutingSection(props: ProjectRoutingProps) {
  return (
    <section className="rounded-[2rem] border border-white/10 bg-[var(--bg-elevated)] p-6 shadow-xl shadow-black/20 backdrop-blur sm:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Project routing</h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-[var(--muted)]">
            Each GitHub repo becomes a project. Map them to Linear projects for richer summaries.
          </p>
        </div>
        <div className="text-sm text-[var(--muted)]">
          {props.projects.length} tracked repo{props.projects.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="mt-6 grid gap-4">
        {props.projects.length ? (
          props.projects.map((project) => (
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
                  </div>
                  <p className="text-sm text-[var(--muted)]">
                    {project.linearProjectName
                      ? `Mapped to ${project.linearProjectName}`
                      : props.linearConnected
                        ? "No Linear project mapped yet."
                        : "Connect Linear if you want issue updates in summaries."}
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex flex-col gap-2 sm:min-w-72">
                    <select
                      className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-2 text-sm text-white"
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
                    <button
                      className={`${buttonBase} border border-sky-300/20 bg-sky-300/10 text-sky-50 hover:bg-sky-300/20`}
                      disabled={!props.linearConnected || props.busyAction === `linear:${project.id}`}
                      onClick={() => props.onSave(project.id)}
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
  );
}

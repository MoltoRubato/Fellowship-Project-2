"use client";

interface GithubReposSectionProps {
  repos: Array<{
    id: string;
    nameWithOwner: string;
    url: string;
    visibility: string;
  }>;
}

export function GithubReposSection(props: GithubReposSectionProps) {
  return (
    <div className="rounded-[2rem] border border-white/10 bg-[var(--bg-elevated)] p-6 shadow-xl shadow-black/20 backdrop-blur sm:p-8">
      <h2 className="text-2xl font-semibold">Visible GitHub repos</h2>
      <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
        This is what the connected GitHub OAuth account is currently exposing to the app.
      </p>

      <div className="mt-6 grid gap-3">
        {props.repos.length ? (
          props.repos.map((repo) => (
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
  );
}

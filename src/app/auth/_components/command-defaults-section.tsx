"use client";

export function CommandDefaultsSection() {
  return (
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
  );
}

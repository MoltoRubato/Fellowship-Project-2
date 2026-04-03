Use the following values:
{{PROMPT_VALUES}}

Generate a Slack-ready summary of {{WORK_LABEL}} work.

Important goals:
- Support work spanning multiple repositories in one summary.
- Start with a short `Status snapshot` section that gives a 2-3 bullet TL;DR.
- Group related work under ticket headings whenever you can.
- Prefer grouping by ticket identifier such as `RM-14471` or `CX-3070`.
- If there is no clear ticket, place the work under `Other`.
- Prefer a Linear issue title for the group heading when available.
- Otherwise prefer a GitHub PR title for the group heading.
- Otherwise use the ticket identifier alone.
- Put related updates, commits, and PR activity as bullets underneath that heading.
- Never leave a ticket heading without at least one bullet.
- End with a `Needs review` section when there are open PRs that are waiting on review.
- Keep the summary backward-looking. Do not include a `Next up` or `What's next` section.
- Do not ask the user any clarifying or follow-up questions.

Formatting rules for the `summary` field:
- The first line must be exactly `{{HEADER_LABEL}}`
- After the header, use markdown-style section headings that start with `## `
- Always include `## Status snapshot` immediately after the header
- The `Status snapshot` section must contain 2-3 `- ` bullets
- Render each ticket group as its own `## ` heading such as `## RM-14471 - Fix All`
- Under each ticket heading, use `- ` bullets for the completed work
- Use `## Other` for unticketed or miscellaneous work
- Use `## Needs review` only when there are PRs actively waiting on someone else
- Use `## Blockers` only if blockers exist
- Do not use `Update #...`, `Today's work:`, or `In progress:`
- Keep bullets factual and concise
- If a metric is unknown, omit the number instead of inventing it

Link and reference rules:
- If a ticket heading corresponds to a Linear issue or GitHub PR with a `source_ref`, append `[ref:source_ref]` to the end of that heading line
- If a bullet corresponds to a specific linked item such as a commit, PR, or Linear issue, append `[ref:source_ref]` to the end of that bullet
- If a `Needs review` bullet corresponds to a PR with a `source_ref`, append `[ref:source_ref]`
- Do not invent source refs
- If you are unsure what a commit means, request it in `request_commits`

General rules:
- Use the provided `status_hint`, `ticket`, `repo`, link metadata, and prior answers when useful
- Treat Linear state changes like "moved to Done" or "moved to In Progress" as real workflow signals
- Keep work from different repos together when it belongs to the same ticket
- Do not create headings for repositories unless there is no better ticket-based grouping
- Do not output any text outside YAML
- Always return `questions: []`

Return YAML only in this exact shape:

```yaml
summary: |
  {{HEADER_LABEL}}

  ## Status snapshot
  - Progress moved forward across the Fix All and MCP reliability workstreams.
  - Shipped the BullMQ flows spike and kept the MCP revamp PR moving.
  - One open PR is currently waiting on review.

  ## RM-14471 - Fix All (Docs Audit) [ref:linear_rm_14471]
  - Completed the BullMQ Flows spike. [ref:commit_commit_sha_here]
  - Started wiring the API routes and worker.
  - Addressed review feedback on the agent and job model PRs. [ref:pr_17883]

  ## Other
  - Reviewed PRs throughout the week.

  ## Needs review
  - RM-15476 MCP revamp [ref:pr_17883]

  ## Blockers
  - Waiting on final feedback for the MCP revamp PR.
questions: []
request_commits: []
```

If additional answers are provided later, use them as extra context for the next summary. Any further responses in this context window must follow the same YAML format.

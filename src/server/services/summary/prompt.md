Use the following values:
{{PROMPT_VALUES}}

I want you to generate a quick summary of {{WORK_LABEL}} work as a Slack message.

These are passed in ascending order of when they were noted/comitted.

Each task may include a status_hint. You may trust explicit completed or in_progress hints when the wording is direct.

Linear state changes like "moved to Done" or "moved to In Progress" are meaningful workflow signals and should be treated accordingly.

You must analyse these commit messages and identify tasks that have been completed and tasks that are in progress.

The final note should be formatted as such:

Update #{{UPDATE_NO}}
{{SUMMARY_LABEL}}
- Fixed Facebook oauth2 raising missing read scope errors.
- Sped up table search queries from 1~2 seconds to 50ms.
- Polished left dashboard buttons.

In progress:
- Adding Linear as a supported integration.

Blockers:
- Was set back by a misconfigured Facebook oauth setting.
- Awaiting on the design team for a final mockup of the home page.

Do not change the update number and today's date.

Only include the In progress: and/or Blockers: section if there is any.

Each dot point text (excluding any link suffix) must be strictly 100 characters or less, but aim for 50 or less.

If a task or commit comes from GitHub or Linear and includes link metadata in the input payload, append this exact suffix at the end of that dot point:
- `Link`
- Example: `- Reviewed OAuth callback handling. - Link`

If a task or commit includes a `source_ref` value, you MUST preserve it at the end of that exact dot point as `[ref:source_ref]`, immediately before any ` - Link` suffix.

Do not combine multiple GitHub or Linear items with different `source_ref` values into one bullet. Keep linked source items as separate bullets so each non-manual bullet maps cleanly to its own link.

Do not ask the user any clarifying or follow-up questions. Always return a best-effort final summary immediately.

If you are unsure whether something is completed or still ongoing, prefer conservative wording or place it under "In progress:" instead of inventing certainty.

If you do not know the actual value for a numeric metric, omit that numeric detail from the final summary instead of inventing or repeating a placeholder.

ALL your responses in this context window MUST be outputted as the following yaml and nothing else outside of the yaml format. DO NOT add any additional text other than the format specified. Do not include the ```yaml or ```.

Always return `questions: []`.

If you are unsure of what a particular commit is about, you must ask to view the commit's code in the request_commits field below.

When the user's answers are provided below, treat them as extra context that can improve the summary. Do not ask new questions in response.

e.g. Has summary, with no follow up questions and no commits to view:

```yaml
summary: |
  Update #{{UPDATE_NO}}
  {{SUMMARY_LABEL}}
  - Fixed Facebook oauth2 raising missing read scope errors.
  - Sped up table search queries from 1~2 seconds to 50ms.
  - Polished left dashboard buttons.
  In progress:
  - Adding Linear as a supported integration.
  Blockers:
  - Was set back by a misconfigured Facebook oauth setting.
  - Awaiting on the design team for a final mockup of the home page.
questions: []
request_commits: []
```

If additional answers are provided in later prompts in the same context, use them as extra context for the next summary. Any further responses in this context window MUST be formatted as above.

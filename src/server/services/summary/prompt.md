Use the following values:
{{PROMPT_VALUES}}

I want you to generate a quick summary of {{WORK_LABEL}} work as a Slack message.

These are passed in ascending order of when they were noted/comitted.

Each task may include a status_hint. You may trust explicit completed or in_progress hints when the wording is direct.

You must analyse these commit messages and identify tasks that have been completed and tasks that are in progress. If you are unsure, you may ask questions specified later below in this message. DO NOT take a guess as to what's completed or in progress if unsure.

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

Each dot point must be strictly 100 characters or less, but aim for 50 or less.

You must ask any clarifying questions until you are 100% certain on what tasks are still in progress and what tasks are done, and any other questions.

You should also ask questions to ask and encourage the user any numeric descriptions (if the point makes sense to e.g. no need for design changes) such as the '1~2 seconds to 50ms' point. In the questions, write a suggested times and aspects of measurement by taking a guess by writing them as 'e.g. ...'

ALL your responses in this context window MUST be outputted as the following yaml and nothing else outside of the yaml format. DO NOT add any additional text other than the format specified. Do not include the ```yaml or ```.

You may assume that for questions, they will ALL have an additional option below for users to type their own response.

If you are unsure of what a particular commit is about, you must ask to view the commit's code in the request_commits field below.

e.g. No summary yet, and instead has follow up questions:

```yaml
summary: null
questions:
- message: "What measureable improvements were made for speeding up the table search queries? e.g. sped up from 1~2 seconds to 50ms?"
  options:
  - "From 1~2 seconds to 50ms"
  - "No measureable improvements known"
- message: "Is adding Linear as a supported integration still in-progress or completed?"
  options:
  - "In progress"
  - "Completed"
  - "Abandoned"
request_commits: [03e34d545967cba4f6ba0b7fe42cc5affbd2c2db]
```

e.g. Has summary, with no more follow up questions and no commits to view:

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
questions:
request_commits:
```

You may also include both a summary to serve as a preview and follow-up questions and commit view requests.
Answers to questions will be followed up in later prompts in the same context. Any further responses in this context window MUST be formatted as above.

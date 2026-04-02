# Demo Meeting Script — Day 4

**Duration:** ~25-30 minutes
**Setup required before the meeting (see Pre-Demo Checklist at bottom)**

---

## 1. Opening (2 min)

> "Thanks for jumping on. We're on day 4 of 5 — all the core features from the proposal are built and deployed to production. Today I want to walk you through the full workflow an engineer would experience, from first setup to pasting a standup summary. I'll do it live so you can see exactly how it feels in Slack."

> "Quick agenda: I'll start with how a new engineer connects their accounts, then show the day-to-day logging, and finish with the summary generation — which is the main payoff. Feel free to jump in with questions at any point."

---

## 2. Auth Flow (3 min)

**What you're showing:** A brand new engineer setting up the bot for the first time.

**Steps:**

1. Open Slack. Type `/auth` in any channel.
2. Point out the ephemeral response: *"I sent your auth link in DM."*
3. Switch to the bot's DM. Show the message:
   - *"Here is your secure dashboard link for connecting GitHub and Linear."*
   - Clickable link: *"Open your secure auth page"*
   - *"From there you can connect GitHub and Linear, review visible projects, and pick your default repo."*
4. Click the link. The dashboard opens in browser.

**On the dashboard, point out:**
- Header: *"Connections — Connect GitHub and Linear, then map repos to the right projects."*
- Two provider cards showing GitHub and Linear, both with grey "Not connected" status dots
- Click **"Connect GitHub"** — walk through the OAuth consent screen, then return
- Show the card update: green dot, *"Connected as [username]"*
- Click **"Connect Linear"** — same flow
- Show both cards now green/connected

5. Expand **"Project Routing"** section.
   - Show the list of GitHub repos pulled in automatically
   - Click **"Edit"** on a repo, show the Linear project dropdown (formatted as *"TEAMKEY - ProjectName"*)
   - Select the correct Linear project, click **"Save"**

**Say:**
> "That's the full onboarding. One-time setup, takes about a minute. The link token expires after 24 hours for security, and all OAuth tokens are encrypted at rest with AES-256. From here, the engineer never needs to touch the dashboard again unless they change projects."

---

## 3. Logging Work with /did (3 min)

**What you're showing:** How an engineer logs updates throughout the day.

**Steps:**

1. In Slack, type `/did`
2. A modal opens:
   - Title: **"Log work update"**
   - **Repo** dropdown (pre-populated with connected repos, placeholder: *"Pick a repo"*)
   - **"What did you work on?"** text field (placeholder: *"Finished the auth callback flow and verified the dashboard."*)
3. Select the demo repo from the dropdown
4. Type: `Implemented the OAuth token refresh flow and added error handling for expired tokens`
5. Click **"Log update"**
6. Show the confirmation: `Logged #1 for owner/repo: "Implemented the OAuth token refresh flow and added error handling for expired tokens"`

**Log a second entry:**

1. `/did` again
2. Same repo
3. Type: `Reviewed and approved PR #42 for rate limiting middleware`
4. Submit — shows `Logged #2 for owner/repo: ...`

**Say:**
> "Each entry gets numbered per day — #1, #2, and so on. These reset daily. The repo field is optional — if an engineer only works on one project, they can skip it and the bot uses their most recent repo. Engineers can fire these off throughout the day whenever they finish something, takes about 5 seconds each."

---

## 4. Logging Blockers with /blocker (1 min)

**Steps:**

1. Type `/blocker`
2. Modal opens:
   - Title: **"Log blocker"**
   - **"What is blocking you?"** text field (placeholder: *"Waiting on GitHub OAuth callback URL to be updated."*)
3. Type: `Waiting on AWS Secrets Manager access — raised with DevOps`
4. Submit — shows `Logged blocker #3 for owner/repo: "Waiting on AWS Secrets Manager access — raised with DevOps"`

**Say:**
> "Blockers are tracked separately from regular updates. They show up in their own section in the summary so nothing gets buried."

---

## 5. Edit and Delete (2 min)

**What you're showing:** Engineers can fix mistakes without starting over.

**Edit:**

1. Type `/edit`
2. Modal opens:
   - Title: **"Edit entry"**
   - Dropdown: **"Pick an entry"** — shows the last 12 entries formatted as `#1 — Implemented the OAuth token refresh...`
3. Select entry #1
4. Show the preview section that appears: `#1 | owner/repo | date` with the full content
5. The **"Updated text"** field is pre-filled with the original text
6. Change it to: `Implemented OAuth token refresh flow with retry logic for expired tokens`
7. Click **"Save"** — shows `Updated #1: "Implemented OAuth token refresh flow with retry logic for expired tokens"`

**Delete:**

1. Type `/delete`
2. Select an entry from the dropdown
3. Show the preview
4. Click **"Delete"** — shows `Deleted #3: "..."`

**Say:**
> "Entries are soft-deleted, not permanently removed — so there's an audit trail. Edit and delete both show the last 12 entries for that day, so engineers can quickly find what they need."

---

## 6. Summary Generation (7 min) — The Main Event

**What you're showing:** The AI-powered summary that pulls everything together.

**Say before starting:**
> "This is the core feature — where everything comes together. The bot pulls in manual logs, GitHub commits and PRs, and Linear issue activity, then generates a formatted standup summary."

**Steps:**

1. Type `/summarise`
2. If you want to scope it, add one or more repos directly in the command, e.g. `/summarise readmeio/readme readmeio/gitto week`
3. The bot starts generating. Point out: *"Generating your standup summary..."*
4. The final summary is posted directly in Slack without any clarification step

**Point out the summary structure:**

> "Here's what the output looks like — I'll walk through each section."

- **One-line header** — AI-generated summary of the day's key progress
- **Completed** — bullet list merging manual /did entries with GitHub commits
- **In progress** — anything the AI identified as ongoing
- **Blockers** — all /blocker entries, prefixed with the warning emoji
- **GitHub activity** — commits and PRs with clickable links to the actual PRs/commits
- **Linear activity** — issue status changes (e.g., *"ENG-204 moved to In Review"*)
- **Date/time footer**

**Say:**
> "The engineer's workflow at end of day is: type /summarise, review the generated summary, then copy-paste the result into the standup channel. The whole thing takes under 30 seconds — that was the target we set in the proposal."

> "The summary automatically includes GitHub and Linear activity without the engineer doing anything extra. Commits, PRs, and issue status changes are all synced throughout the day — the engineer doesn't need to remember or manually list them."

---

## 7. Reminders (2 min)

**Steps:**

1. Type `/reminders`
2. Show the status message:
   ```
   Your reminders are on.
   Days: Mon-Fri
   Reminders: Morning (9am), End of day (5pm)
   ```
   - Context line: *"Times follow your current Slack timezone."*
   - Two buttons: **"Configure"** and **"Turn off"**

3. Click **"Configure"** — modal opens:
   - Title: **"Reminder settings"**
   - Header: *"Choose which days and which reminder types you want. Times follow your current Slack timezone."*
   - **Days** checkboxes: Monday through Sunday (Mon-Fri pre-checked)
   - **Reminder types** checkboxes: *"Morning (9am)"* and *"End of day (5pm)"*
4. Toggle a day off, click **"Save"** — show the updated status

**Say:**
> "Engineers get two automated DMs per day: a morning check-in at 9am that says 'what are you working on today? Use /did to log your first update', and an end-of-day nudge at 5pm that says 'run /summarise when you're ready'. Times follow their Slack timezone, and they can configure or turn them off anytime. The bot only sends reminders to people who've already used it — new users don't get spammed."

---

## 8. Weekly Summary (1 min)

**Steps:**

1. Type `/summarise week`
2. Show that it generates a summary covering the entire week's entries, not just today

**Say:**
> "Same command, just add 'week' — useful for Monday standups or weekly check-ins."

---

## 9. Wrap-Up and Discussion (5-7 min)

**Recap what's delivered against the proposal:**

> "Let me quickly map this back to what we scoped:
>
> - **7 slash commands** — /did, /blocker, /edit, /delete, /summarise, /auth, /reminders — all working in production
> - **GitHub integration** — OAuth, commit sync, PR tracking, clickable links in summaries
> - **Linear integration** — OAuth, issue status tracking, project routing
> - **AI summaries** — structured output matching the format in the proposal, generated directly from synced context
> - **Reminders** — timezone-aware, configurable per engineer
> - **Security** — AES-256 token encryption, one-time auth links with 24hr expiry, soft deletes
> - **Deployed** — live on Railway right now"

**Day 5 priorities — ask for direction:**

> "Tomorrow is our last day. I have a few options for how to spend it and I'd like your input:
>
> 1. **Polish and edge cases** — hardening error states, handling slow networks gracefully
> 2. **Documentation** — setup guide, onboarding instructions for engineers
> 3. **Any adjustments** to the summary format, reminder timing, or workflow based on what you just saw
> 4. **Stretch features** — anything from the proposal's nice-to-haves you'd want prioritized
>
> What's most valuable to you?"

**Collect feedback:**

> "A couple of specific questions:
> - Does the summary format match what your team actually pastes into standups, or would you change the sections?
> - Are the two reminder times (9am and 5pm) right for your team?
> - Is there anything in the workflow that felt like too many steps?"

---

## Pre-Demo Checklist (do this 30 min before the meeting)

- [ ] **Create test data.** Log 2-3 `/did` entries and 1 `/blocker` so `/summarise` has content to work with
- [ ] **Make a real commit.** Push at least one commit to the connected GitHub repo so GitHub activity appears in the summary
- [ ] **Move a Linear issue.** Change the status of an issue (e.g., move to "In Review") so Linear activity appears
- [ ] **Test `/summarise` once end-to-end.** Make sure the AI generates a summary without errors and the final output looks clean
- [ ] **Verify the dashboard loads.** Open the auth link, confirm both GitHub and Linear show as connected with green dots, confirm Project Routing shows the mapped repo
- [ ] **Have two windows ready:** Slack (with the bot DM open) and a browser (with the dashboard)
- [ ] **Check Railway deployment is up.** Hit the app URL in browser — should load without errors
- [ ] **Clear old test data if needed.** Use `/delete` to remove any messy entries from previous testing so the demo entries are clean and numbered #1, #2, #3

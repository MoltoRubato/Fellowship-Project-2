# Standup Bot

Slack-first standup bot with a small Next.js dashboard for auth and repo routing.

It lets each engineer:
- connect GitHub and Linear
- log updates and blockers from Slack
- generate standup summaries from manual logs plus synced GitHub/Linear activity
- generate those summaries directly in Slack without follow-up prompts
- control reminder timing and schedule per user

## Stack

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS
- tRPC
- Prisma + PostgreSQL
- Slack Bolt (Socket Mode)
- GitHub OAuth
- Linear OAuth
- Gemini for summary generation

## Core Flows

### 1. Slack commands

The bot registers these commands in code:

- `/auth`
- `/did`
- `/blocker`
- `/edit`
- `/delete`
- `/summarise`
- `/reminders`

Important:
- Slack slash commands still need to be created in the Slack app dashboard.
- This repo does not currently include a Slack manifest file.

### 2. Auth dashboard

The `/auth` page is the web UI for:

- connecting GitHub
- connecting Linear
- mapping GitHub repos to Linear projects

Main frontend entry point:
- [src/app/auth/page.tsx](/Users/ryan/Desktop/Fellowship-Project-2/src/app/auth/page.tsx)

### 3. Logging work

Users log work from Slack:

- `/did` for updates
- `/blocker` for blockers
- `/edit` and `/delete` for recent manual entries

Entries are stored in `log_entries` and numbered per user, per local day.

### 4. Summaries

`/summarise` builds a standup summary from:

- manual logs
- synced GitHub commits / PRs
- synced Linear issue activity

The bot posts a best-effort summary immediately instead of asking clarifying questions.
It can summarise across all active repos by default, or across whichever repos you pass directly in the command.

### 5. Reminders

Reminders are per user and respect the user’s Slack timezone.

Users can control:

- on/off state
- selected weekdays
- morning and/or end-of-day reminders

## Project Structure

```text
src/
  app/                   Next.js app router pages and API routes
  bot/                   Slack bot entry point, commands, reminders, scheduled jobs
  lib/                   Shared helpers for reminders, local time, summary placeholders
  server/
    api/                 tRPC routers
    services/            business logic for auth, standup logging, summaries, integrations
prisma/
  schema.prisma          database schema
scripts/
  backfill-user-numbering.ts
public/
  standup-bot-icon.png
```

Useful service areas:

- `src/server/services/standup/`
  logging, repo resolution, user/project state, reminders
- `src/server/services/summary/`
  prompt construction, AI parsing, fallback summary generation
- `src/server/services/integrations/`
  GitHub and Linear OAuth + activity sync
- `src/bot/commands/`
  Slack command handlers and summary delivery flow

## Environment Variables

Copy `.env.example` to `.env` and fill in the values.

Main groups:

- App: `APP_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`
- Slack: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`
- Database: `DATABASE_URL`
- OAuth: GitHub + Linear client credentials
- AI: `GOOGLE_AI_API_KEY`, optional `GOOGLE_AI_MODEL`
- Encryption: `ENCRYPTION_KEY`

See:
- [.env.example](/Users/ryan/Desktop/Fellowship-Project-2/.env.example)

## Local Development

Install dependencies:

```bash
npm install
```

Generate Prisma client:

```bash
npx prisma generate
```

Push schema to your local database:

```bash
npx prisma db push
```

Run web app + bot together:

```bash
npm run dev
```

Run only the web app:

```bash
npm run dev:web
```

Run only the bot:

```bash
npm run dev:bot
```

## Database Notes

The schema lives in:
- [prisma/schema.prisma](/Users/ryan/Desktop/Fellowship-Project-2/prisma/schema.prisma)

This project currently uses `prisma db push` style development rather than a checked-in migration history.

Useful scripts:

```bash
npm run db:generate
npm run db:push
npm run db:studio
```

There is also a one-off backfill script for per-user daily numbering:

```bash
npm run db:backfill-numbering
```

## Build

```bash
npm run build
```

Production start command:

```bash
npm run start
```

## Deploying To Railway

Typical deploy flow:

```bash
railway up
```

If the schema changed:

```bash
railway run npx prisma db push
```

If the per-user daily numbering schema changed and old rows need reprocessing:

```bash
railway run npm run db:backfill-numbering
```

Recommended order when both app code and schema changed:

```bash
railway run npx prisma db push
railway run npm run db:backfill-numbering
railway up
```

## Operational Notes

- The bot uses Slack Socket Mode in [src/bot/index.ts](/Users/ryan/Desktop/Fellowship-Project-2/src/bot/index.ts).
- Reminder sends use each Slack user’s timezone instead of a hardcoded team timezone.
- Plain DMs are ignored; the bot only acts on commands and interactive flows.
- Summary links are normalized into a single clickable Slack `Link` suffix.
- Placeholder metric values are blocked from leaking into final summaries.

## Commands Reference

### `/auth`

Sends the user a dashboard auth link.

### `/did`

Logs a work update.

### `/blocker`

Logs a blocker.

### `/edit`

Edits a recent manual entry.

### `/delete`

Deletes a recent manual entry.

### `/summarise`

Generates a standup summary immediately in Slack.
Supports `/summarise`, `/summarise week`, or `/summarise repo/one repo/two week`.

### `/reminders`

Shows or updates reminder settings.

Examples:

```text
/reminders
/reminders on
/reminders off
```

## Known Setup Gaps

- Slash commands are configured in the Slack app dashboard, not from this repo.
- If a command is missing from Slack autocomplete, add it in the Slack app settings and reinstall the app.
- If duplicate commands appear in Slack autocomplete, you likely have multiple Slack apps installed with overlapping slash command names.

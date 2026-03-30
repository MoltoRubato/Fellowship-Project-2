import { EntrySource, EntryType } from "@prisma/client";
import type { App, SlackCommandMiddlewareArgs, AllMiddlewareArgs } from "@slack/bolt";
import { generateStandupSummary, getSummaryWindow } from "@/server/services/summary";
import {
  deleteManualEntry,
  editManualEntry,
  ensureSlackUser,
  getUserContextBySlackId,
  isRepoLike,
  listActiveBlockers,
  listEntriesSince,
  listRecentManualEntries,
  logEntry,
  normalizeRepo,
  syncConnectedActivity,
} from "@/server/services/standup";
import { sendAuthLinkDm } from "@/server/services/slack";

type CommandArgs = SlackCommandMiddlewareArgs & AllMiddlewareArgs;

function parseRepoAndText(rawText: string, defaultRepo?: string | null) {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return {
      repo: defaultRepo ? normalizeRepo(defaultRepo) : null,
      text: "",
    };
  }

  const parts = trimmed.split(/\s+/);
  const firstToken = parts[0];

  if (isRepoLike(firstToken)) {
    return {
      repo: normalizeRepo(firstToken),
      text: parts.slice(1).join(" ").trim(),
    };
  }

  return {
    repo: defaultRepo ? normalizeRepo(defaultRepo) : null,
    text: trimmed,
  };
}

function parseEditArgs(rawText: string, defaultRepo?: string | null) {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  let index = 0;
  let repo = defaultRepo ? normalizeRepo(defaultRepo) : null;

  if (isRepoLike(parts[0])) {
    repo = normalizeRepo(parts[0]);
    index = 1;
  }

  const displayId = Number(parts[index]);
  const text = parts.slice(index + 1).join(" ").trim();

  if (!Number.isInteger(displayId) || displayId <= 0) {
    return null;
  }

  return { repo, displayId, text };
}

function parseDeleteArgs(rawText: string, defaultRepo?: string | null) {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  let repo = defaultRepo ? normalizeRepo(defaultRepo) : null;
  let idToken = parts[0];

  if (isRepoLike(parts[0])) {
    repo = normalizeRepo(parts[0]);
    idToken = parts[1] ?? "";
  }

  const displayId = Number(idToken);
  if (!Number.isInteger(displayId) || displayId <= 0) {
    return null;
  }

  return { repo, displayId };
}

function parseSummaryArgs(rawText: string, defaultRepo?: string | null) {
  const parts = rawText.trim().split(/\s+/).filter(Boolean);
  let period: "today" | "week" = "today";
  let repo = defaultRepo ? normalizeRepo(defaultRepo) : null;

  for (const part of parts) {
    if (part.toLowerCase() === "week") {
      period = "week";
      continue;
    }

    if (isRepoLike(part)) {
      repo = normalizeRepo(part);
    }
  }

  return { repo, period };
}

async function maybeSendOnboardingLink(slackUserId: string, slackTeamId: string, created: boolean) {
  if (!created) {
    return false;
  }

  await sendAuthLinkDm({
    slackUserId,
    slackTeamId,
    reason: "You can start logging immediately, and this link lets you connect GitHub and Linear when you're ready.",
  });

  return true;
}

async function resolveDefaultRepo(slackUserId: string) {
  const user = await getUserContextBySlackId(slackUserId);
  return user?.defaultProject?.githubRepo ?? user?.projects[0]?.githubRepo ?? null;
}

async function resolveDisplayName(client: App["client"], slackUserId: string, fallback: string) {
  try {
    const info = await client.users.info({ user: slackUserId });
    return info.user?.real_name || info.user?.profile?.display_name || fallback;
  } catch {
    return fallback;
  }
}

function formatRecentEntriesHelp(entries: Awaited<ReturnType<typeof listRecentManualEntries>>) {
  if (!entries.length) {
    return "No editable entries found yet.";
  }

  const lines = entries.map(
    (entry) =>
      `• #${entry.displayId}${entry.project?.githubRepo ? ` (${entry.project.githubRepo})` : ""}: ${entry.content}`,
  );

  return ["Recent manual entries:", ...lines].join("\n");
}

export async function handleDid(args: CommandArgs) {
  const { command, ack, respond } = args;
  await ack();

  const { user, created } = await ensureSlackUser(command.user_id, command.team_id);
  const defaultRepo = (await resolveDefaultRepo(command.user_id)) ?? null;
  const parsed = parseRepoAndText(command.text ?? "", defaultRepo);

  if (!parsed.text) {
    await respond({
      response_type: "ephemeral",
      text: "Usage: `/did [owner/repo] finished the OAuth callback flow`",
    });
    return;
  }

  const entry = await logEntry({
    slackUserId: command.user_id,
    slackTeamId: command.team_id,
    repo: parsed.repo,
    content: parsed.text,
    entryType: EntryType.update,
    source: EntrySource.manual,
  });

  const sentOnboarding = await maybeSendOnboardingLink(command.user_id, command.team_id, created);
  const repoLabel = parsed.repo ? ` for *${parsed.repo}*` : "";

  await respond({
    response_type: "ephemeral",
    text: `✅ Logged #${entry.displayId}${repoLabel}: _"${parsed.text}"_${sentOnboarding ? "\nI also sent you an auth link in DM so you can connect GitHub or Linear later." : ""}`,
  });
}

export async function handleBlocker(args: CommandArgs) {
  const { command, ack, respond } = args;
  await ack();

  const { created } = await ensureSlackUser(command.user_id, command.team_id);
  const defaultRepo = (await resolveDefaultRepo(command.user_id)) ?? null;
  const parsed = parseRepoAndText(command.text ?? "", defaultRepo);

  if (!parsed.text) {
    await respond({
      response_type: "ephemeral",
      text: "Usage: `/blocker [owner/repo] waiting on access from DevOps`",
    });
    return;
  }

  const entry = await logEntry({
    slackUserId: command.user_id,
    slackTeamId: command.team_id,
    repo: parsed.repo,
    content: parsed.text,
    entryType: EntryType.blocker,
    source: EntrySource.manual,
  });

  const sentOnboarding = await maybeSendOnboardingLink(command.user_id, command.team_id, created);
  const repoLabel = parsed.repo ? ` for *${parsed.repo}*` : "";

  await respond({
    response_type: "ephemeral",
    text: `🚧 Logged blocker #${entry.displayId}${repoLabel}: _"${parsed.text}"_${sentOnboarding ? "\nA setup link is waiting in your DM as well." : ""}`,
  });
}

export async function handleEdit(args: CommandArgs) {
  const { command, ack, respond } = args;
  await ack();

  const defaultRepo = (await resolveDefaultRepo(command.user_id)) ?? null;
  const parsed = parseEditArgs(command.text ?? "", defaultRepo);
  if (!parsed?.text) {
    const helpEntries = await listRecentManualEntries(command.user_id, 5);
    await respond({
      response_type: "ephemeral",
      text: `Usage: \`/edit [owner/repo] entryId new text\`\n${formatRecentEntriesHelp(helpEntries)}`,
    });
    return;
  }

  const entry = await editManualEntry(command.user_id, parsed.displayId, parsed.text, parsed.repo);
  if (!entry) {
    const helpEntries = await listRecentManualEntries(command.user_id, 5);
    await respond({
      response_type: "ephemeral",
      text: `I couldn't find editable entry #${parsed.displayId}.\n${formatRecentEntriesHelp(helpEntries)}`,
    });
    return;
  }

  await respond({
    response_type: "ephemeral",
    text: `✏️ Updated #${entry.displayId}: _"${entry.content}"_`,
  });
}

export async function handleDelete(args: CommandArgs) {
  const { command, ack, respond } = args;
  await ack();

  const defaultRepo = (await resolveDefaultRepo(command.user_id)) ?? null;
  const parsed = parseDeleteArgs(command.text ?? "", defaultRepo);
  if (!parsed) {
    const helpEntries = await listRecentManualEntries(command.user_id, 5);
    await respond({
      response_type: "ephemeral",
      text: `Usage: \`/delete [owner/repo] entryId\`\n${formatRecentEntriesHelp(helpEntries)}`,
    });
    return;
  }

  const entry = await deleteManualEntry(command.user_id, parsed.displayId, parsed.repo);
  if (!entry) {
    const helpEntries = await listRecentManualEntries(command.user_id, 5);
    await respond({
      response_type: "ephemeral",
      text: `I couldn't find deletable entry #${parsed.displayId}.\n${formatRecentEntriesHelp(helpEntries)}`,
    });
    return;
  }

  await respond({
    response_type: "ephemeral",
    text: `🗑️ Deleted #${entry.displayId}: _"${entry.content}"_`,
  });
}

export async function handleSummarise(args: CommandArgs) {
  const { command, ack, respond, client } = args;
  await ack();
  await respond({
    response_type: "ephemeral",
    text: "⏳ Generating your standup summary...",
  });

  await ensureSlackUser(command.user_id, command.team_id);
  const defaultRepo = (await resolveDefaultRepo(command.user_id)) ?? null;
  const { repo, period } = parseSummaryArgs(command.text ?? "", defaultRepo);
  const since = getSummaryWindow(period);

  const user = await getUserContextBySlackId(command.user_id);
  if (!user) {
    await respond({
      response_type: "ephemeral",
      text: "I couldn't find your profile yet. Run `/auth` and try again.",
    });
    return;
  }

  try {
    await syncConnectedActivity(user, since, repo);
  } catch (error) {
    console.error("Activity sync failed", error);
  }

  const entries = await listEntriesSince(command.user_id, since, repo);
  const blockers = await listActiveBlockers(command.user_id, repo);

  if (!entries.length && !blockers.length) {
    await respond({
      response_type: "ephemeral",
      text: `No entries found for ${period === "week" ? "this week" : "today"}. Try \`/did\` or \`/blocker\` first.`,
    });
    return;
  }

  const userName = await resolveDisplayName(client, command.user_id, command.user_name);
  const summary = await generateStandupSummary({
    userName,
    period,
    entries,
    blockers,
  });

  await respond({
    response_type: "in_channel",
    text: summary,
  });
}

export async function handleAuth(args: CommandArgs) {
  const { command, ack, respond } = args;
  await ack();

  await ensureSlackUser(command.user_id, command.team_id);
  await sendAuthLinkDm({
    slackUserId: command.user_id,
    slackTeamId: command.team_id,
    reason: "Here is your secure dashboard link for connecting GitHub and Linear.",
  });

  await respond({
    response_type: "ephemeral",
    text: "I sent your auth link in DM.",
  });
}

export async function handleDirectMessage(app: App, userId: string, text: string) {
  const info = await app.client.users.info({ user: userId });
  const teamId = info.user?.team_id;
  if (!teamId) {
    return;
  }

  const { created } = await ensureSlackUser(userId, teamId);
  const defaultRepo = (await resolveDefaultRepo(userId)) ?? null;
  const parsed = parseRepoAndText(text, defaultRepo);
  if (!parsed.text) {
    return;
  }

  const entry = await logEntry({
    slackUserId: userId,
    slackTeamId: teamId,
    repo: parsed.repo,
    content: parsed.text,
    entryType: EntryType.update,
    source: EntrySource.dm,
  });

  if (created) {
    await maybeSendOnboardingLink(userId, teamId, true);
  }

  await app.client.chat.postMessage({
    channel: userId,
    text: `✅ Logged DM update as #${entry.displayId}${parsed.repo ? ` for ${parsed.repo}` : ""}.`,
  });
}

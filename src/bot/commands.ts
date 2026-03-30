import { EntrySource, EntryType } from "@prisma/client";
import type { App, SlackCommandMiddlewareArgs, AllMiddlewareArgs, SlackViewMiddlewareArgs } from "@slack/bolt";
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
  type UserContext,
} from "@/server/services/standup";
import { sendAuthLinkDm } from "@/server/services/slack";

type CommandArgs = SlackCommandMiddlewareArgs & AllMiddlewareArgs;
type ViewArgs = SlackViewMiddlewareArgs & AllMiddlewareArgs;

const ENTRY_MODAL_CALLBACK_ID = "standup_entry_submit";
const REPO_SELECT_BLOCK_ID = "repo_select_block";
const REPO_SELECT_ACTION_ID = "repo_select_action";
const REPO_INPUT_BLOCK_ID = "repo_input_block";
const REPO_INPUT_ACTION_ID = "repo_input_action";
const MESSAGE_BLOCK_ID = "message_block";
const MESSAGE_ACTION_ID = "message_action";

type ModalEntryType = "update" | "blocker";

function getProjectTimestamp(value?: Date | null) {
  return value instanceof Date ? value.getTime() : 0;
}

function sortProjectsForRepoPicker(projects: UserContext["projects"]) {
  return [...projects].sort((left, right) => {
    const updatedDelta =
      getProjectTimestamp(right.githubRepoUpdatedAt) - getProjectTimestamp(left.githubRepoUpdatedAt);
    if (updatedDelta !== 0) {
      return updatedDelta;
    }

    const usedDelta = getProjectTimestamp(right.lastUsedAt) - getProjectTimestamp(left.lastUsedAt);
    if (usedDelta !== 0) {
      return usedDelta;
    }

    return left.githubRepo.localeCompare(right.githubRepo);
  });
}

function getMostRecentlyUpdatedRepo(user?: UserContext | null) {
  if (!user?.projects.length) {
    return user?.defaultProject?.githubRepo ?? null;
  }

  const [project] = sortProjectsForRepoPicker(user.projects);

  return project?.githubRepo ?? user.defaultProject?.githubRepo ?? null;
}

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

async function loadUserForEntryModal(slackUserId: string, slackTeamId: string) {
  const { created } = await ensureSlackUser(slackUserId, slackTeamId);
  const user = await getUserContextBySlackId(slackUserId);
  return { created, user };
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

function buildRepoOption(repo: string) {
  return {
    text: {
      type: "plain_text" as const,
      text: repo,
    },
    value: repo,
  };
}

async function sendModalConfirmation(
  client: App["client"],
  channelId: string,
  userId: string,
  text: string,
) {
  if (channelId.startsWith("D")) {
    await client.chat.postMessage({
      channel: channelId,
      text,
    });
    return;
  }

  await client.chat.postEphemeral({
    channel: channelId,
    user: userId,
    text,
  });
}

async function openEntryModal(
  args: CommandArgs,
  config: {
    entryType: ModalEntryType;
    title: string;
    submitLabel: string;
    messageLabel: string;
    messagePlaceholder: string;
  },
) {
  const { command, ack, client, respond } = args;
  await ack();

  const { created, user } = await loadUserForEntryModal(command.user_id, command.team_id);
  const defaultRepo = getMostRecentlyUpdatedRepo(user);
  const parsed = parseRepoAndText(command.text ?? "", defaultRepo);
  const repoOptions = sortProjectsForRepoPicker(user?.projects ?? [])
    .slice(0, 100)
    .map((project) => buildRepoOption(project.githubRepo));
  const initialRepo =
    repoOptions.find((option) => option.value === parsed.repo) ??
    repoOptions.find((option) => option.value === defaultRepo) ??
    repoOptions[0];

  const blocks: any[] = [];

  if (repoOptions.length) {
    blocks.push({
      type: "input",
      block_id: REPO_SELECT_BLOCK_ID,
      label: {
        type: "plain_text",
        text: "Repo",
      },
      element: {
        type: "static_select",
        action_id: REPO_SELECT_ACTION_ID,
        placeholder: {
          type: "plain_text",
          text: "Pick a repo",
        },
        options: repoOptions,
        ...(initialRepo ? { initial_option: initialRepo } : {}),
      },
    });
  } else {
    blocks.push({
      type: "input",
      optional: true,
      block_id: REPO_INPUT_BLOCK_ID,
      label: {
        type: "plain_text",
        text: "Repo",
      },
      hint: {
        type: "plain_text",
        text: "Connect GitHub to turn this into a repo picker.",
      },
      element: {
        type: "plain_text_input",
        action_id: REPO_INPUT_ACTION_ID,
        initial_value: parsed.repo ?? "",
        placeholder: {
          type: "plain_text",
          text: "owner/repo",
        },
      },
    });
  }

  blocks.push({
    type: "input",
    block_id: MESSAGE_BLOCK_ID,
    label: {
      type: "plain_text",
      text: config.messageLabel,
    },
    element: {
      type: "plain_text_input",
      action_id: MESSAGE_ACTION_ID,
      multiline: true,
      initial_value: parsed.text,
      placeholder: {
        type: "plain_text",
        text: config.messagePlaceholder,
      },
    },
  });

  try {
    await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        type: "modal",
        callback_id: ENTRY_MODAL_CALLBACK_ID,
        private_metadata: JSON.stringify({
          channelId: command.channel_id,
          teamId: command.team_id,
          entryType: config.entryType,
        }),
        title: {
          type: "plain_text",
          text: config.title,
        },
        submit: {
          type: "plain_text",
          text: config.submitLabel,
        },
        close: {
          type: "plain_text",
          text: "Cancel",
        },
        blocks,
      },
    });
  } catch (error) {
    const slackError =
      typeof error === "object" && error !== null && "data" in error
        ? (error as { data?: { error?: string } }).data?.error
        : undefined;

    if (slackError === "expired_trigger_id") {
      await respond({
        response_type: "ephemeral",
        text: "The Slack modal took too long to open. Please run the command again.",
      });
      return;
    }

    throw error;
  }

  await maybeSendOnboardingLink(command.user_id, command.team_id, created);
}

function resolveRepoFromModal(view: ViewArgs["view"]) {
  const selectedRepo =
    view.state.values[REPO_SELECT_BLOCK_ID]?.[REPO_SELECT_ACTION_ID] &&
    "selected_option" in view.state.values[REPO_SELECT_BLOCK_ID][REPO_SELECT_ACTION_ID]
      ? view.state.values[REPO_SELECT_BLOCK_ID][REPO_SELECT_ACTION_ID].selected_option?.value
      : undefined;

  const typedRepo =
    view.state.values[REPO_INPUT_BLOCK_ID]?.[REPO_INPUT_ACTION_ID] &&
    "value" in view.state.values[REPO_INPUT_BLOCK_ID][REPO_INPUT_ACTION_ID]
      ? view.state.values[REPO_INPUT_BLOCK_ID][REPO_INPUT_ACTION_ID].value
      : undefined;

  return normalizeRepo(selectedRepo ?? typedRepo ?? null);
}

export async function handleDid(args: CommandArgs) {
  await openEntryModal(args, {
    entryType: "update",
    title: "Log work update",
    submitLabel: "Log update",
    messageLabel: "What did you work on?",
    messagePlaceholder: "Finished the auth callback flow and verified the dashboard.",
  });
}

export async function handleBlocker(args: CommandArgs) {
  await openEntryModal(args, {
    entryType: "blocker",
    title: "Log blocker",
    submitLabel: "Log blocker",
    messageLabel: "What is blocking you?",
    messagePlaceholder: "Waiting on GitHub OAuth callback URL to be updated.",
  });
}

export async function handleEntryModalSubmission(args: ViewArgs) {
  const { ack, body, client, view } = args;
  const rawMessage =
    view.state.values[MESSAGE_BLOCK_ID]?.[MESSAGE_ACTION_ID] &&
    "value" in view.state.values[MESSAGE_BLOCK_ID][MESSAGE_ACTION_ID]
      ? view.state.values[MESSAGE_BLOCK_ID][MESSAGE_ACTION_ID].value
      : "";
  const content = (rawMessage ?? "").trim();

  if (!content) {
    await ack({
      response_action: "errors",
      errors: {
        [MESSAGE_BLOCK_ID]: "Please add some detail before submitting.",
      },
    });
    return;
  }

  await ack();

  const metadata = JSON.parse(view.private_metadata || "{}") as {
    channelId?: string;
    teamId?: string;
    entryType?: ModalEntryType;
  };
  const repo = resolveRepoFromModal(view);
  const entryType = metadata.entryType === "blocker" ? EntryType.blocker : EntryType.update;
  const entry = await logEntry({
    slackUserId: body.user.id,
    slackTeamId: metadata.teamId ?? body.team?.id ?? "",
    repo,
    content,
    entryType,
    source: EntrySource.manual,
  });
  const prefix = entryType === EntryType.blocker ? "🚧 Logged blocker" : "✅ Logged";
  const repoLabel = repo ? ` for *${repo}*` : "";
  const channelId = metadata.channelId ?? body.user.id;

  await sendModalConfirmation(
    client,
    channelId,
    body.user.id,
    `${prefix} #${entry.displayId}${repoLabel}: _"${content}"_`,
  );
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

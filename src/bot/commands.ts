import { EntrySource, EntryType } from "@prisma/client";
import type {
  App,
  BlockAction,
  SlackActionMiddlewareArgs,
  SlackCommandMiddlewareArgs,
  AllMiddlewareArgs,
  SlackViewMiddlewareArgs,
} from "@slack/bolt";
import {
  generateStandupSummary,
  getSummaryWindow,
  type SummaryAnswer,
  type SummaryQuestion,
} from "@/server/services/summary";
import {
  completeSummarySession,
  createCompletedSummarySession,
  createPendingSummarySession,
  expireSummarySession,
  getNextSummaryUpdateNo,
  getPendingSummarySession,
  updatePendingSummarySession,
} from "@/server/services/summarySessions";
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
type ActionArgs = SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs;

const ENTRY_MODAL_CALLBACK_ID = "standup_entry_submit";
const SUMMARY_MODAL_CALLBACK_ID = "standup_summary_submit";
const EDIT_MODAL_CALLBACK_ID = "standup_edit_submit";
const DELETE_MODAL_CALLBACK_ID = "standup_delete_submit";
const REPO_SELECT_BLOCK_ID = "repo_select_block";
const REPO_SELECT_ACTION_ID = "repo_select_action";
const REPO_INPUT_BLOCK_ID = "repo_input_block";
const REPO_INPUT_ACTION_ID = "repo_input_action";
const MESSAGE_BLOCK_ID = "message_block";
const MESSAGE_ACTION_ID = "message_action";
const ENTRY_SELECT_BLOCK_ID = "entry_select_block";
const ENTRY_SELECT_ACTION_ID = "entry_select_action";
const ENTRY_PREVIEW_BLOCK_ID = "entry_preview_block";
const EDIT_TEXT_BLOCK_ID = "edit_text_block";
const EDIT_TEXT_ACTION_ID = "edit_text_action";

type ModalEntryType = "update" | "blocker";
type SummaryPeriod = "today" | "week";

type RecentManualEntry = Awaited<ReturnType<typeof listRecentManualEntries>>[number];

function getProjectTimestamp(value?: Date | null) {
  return value instanceof Date ? value.getTime() : 0;
}

function truncatePlainText(text: string, max = 75) {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3))}...`;
}

function formatProjectLabel(project?: {
  githubRepo: string;
  linearProjectName?: string | null;
} | null) {
  if (!project) {
    return "No repo";
  }

  const linearLabel = project.linearProjectName ? ` | ${project.linearProjectName}` : "";
  return truncatePlainText(`${project.githubRepo}${linearLabel}`);
}

function buildProjectOption(project: {
  githubRepo: string;
  linearProjectName?: string | null;
}) {
  return {
    text: {
      type: "plain_text" as const,
      text: formatProjectLabel(project),
    },
    value: project.githubRepo,
  };
}

function buildEntryOption(entry: RecentManualEntry) {
  const repoLabel = entry.project ? formatProjectLabel(entry.project) : "No repo";
  const text = truncatePlainText(`#${entry.displayId} | ${repoLabel} | ${entry.content}`);
  return {
    text: {
      type: "plain_text" as const,
      text,
    },
    value: String(entry.displayId),
  };
}

function buildEntryPreviewText(entry: RecentManualEntry) {
  const label = entry.project ? formatProjectLabel(entry.project) : "No repo";
  return `*Selected entry*\n*#${entry.displayId}* • ${label}\n${entry.content}`;
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

function parseSummaryArgs(rawText: string) {
  const parts = rawText.trim().split(/\s+/).filter(Boolean);
  let period: SummaryPeriod = "today";
  let repo = null as string | null;

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

function sortRepoNamesForRepoPicker(repoNames: string[], user?: UserContext | null) {
  const orderedProjects = sortProjectsForRepoPicker(
    (user?.projects ?? []).filter((project) => repoNames.includes(project.githubRepo)),
  );
  const orderedRepoNames = orderedProjects.map((project) => project.githubRepo);
  const remainingRepoNames = repoNames
    .filter((repo) => !orderedRepoNames.includes(repo))
    .sort((left, right) => left.localeCompare(right));

  return [...orderedRepoNames, ...remainingRepoNames];
}

async function determineSummaryRepoSelection(
  slackUserId: string,
  period: SummaryPeriod,
  user?: UserContext | null,
) {
  const since = getSummaryWindow(period);
  const entries = await listEntriesSince(slackUserId, since);
  const repos = [...new Set(entries.map((entry) => entry.project?.githubRepo ?? null))];
  const scopedRepos = repos.filter((repo): repo is string => Boolean(repo));
  const hasUnscopedEntries = repos.includes(null);

  if (scopedRepos.length > 1) {
    return {
      type: "modal" as const,
      repoNames: sortRepoNamesForRepoPicker(scopedRepos, user),
    };
  }

  if (scopedRepos.length === 1 && !hasUnscopedEntries) {
    return {
      type: "single" as const,
      repo: scopedRepos[0],
    };
  }

  return {
    type: "all" as const,
  };
}

async function generateSummaryResult(input: {
  slackUserId: string;
  slackTeamId: string;
  period: SummaryPeriod;
  repo?: string | null;
  updateNo?: number;
  answers?: SummaryAnswer[];
}) {
  await ensureSlackUser(input.slackUserId, input.slackTeamId);
  const since = getSummaryWindow(input.period);
  const user = await getUserContextBySlackId(input.slackUserId);

  if (!user) {
    return {
      ok: false as const,
      text: "I couldn't find your profile yet. Run `/auth` and try again.",
    };
  }

  try {
    await syncConnectedActivity(user, since, input.repo);
  } catch (error) {
    console.error("Activity sync failed", error);
  }

  const entries = await listEntriesSince(input.slackUserId, since, input.repo);
  const blockers = await listActiveBlockers(input.slackUserId, input.repo);

  if (!entries.length && !blockers.length) {
    return {
      ok: false as const,
      text: `No entries found for ${input.period === "week" ? "this week" : "today"}. Try \`/did\` or \`/blocker\` first.`,
    };
  }

  const projectId =
    input.repo
      ? user.projects.find((project) => project.githubRepo === input.repo)?.id ?? null
      : entries.length === 1
        ? entries[0]?.projectId ?? null
        : null;
  const updateNo = input.updateNo ?? (await getNextSummaryUpdateNo(user.id, projectId));
  const summaryResult = await generateStandupSummary({
    userId: user.id,
    period: input.period,
    updateNo,
    entries,
    blockers,
    answers: input.answers ?? [],
  });

  return {
    ok: true as const,
    userId: user.id,
    projectId,
    updateNo,
    summaryResult,
  };
}

async function openSummaryModal(
  args: CommandArgs,
  config: {
    period: SummaryPeriod;
    repoNames: string[];
    created: boolean;
    user?: UserContext | null;
  },
) {
  const { command, client, respond } = args;

  const orderedRepoNames = sortRepoNamesForRepoPicker(config.repoNames, config.user);
  const projectByRepo = new Map((config.user?.projects ?? []).map((project) => [project.githubRepo, project]));
  const repoOptions = orderedRepoNames.map((repo) => {
    const project = projectByRepo.get(repo);
    return project ? buildProjectOption(project) : buildProjectOption({ githubRepo: repo });
  });
  const defaultRepo = getMostRecentlyUpdatedRepo(config.user);
  const initialRepo =
    repoOptions.find((option) => option.value === defaultRepo) ??
    repoOptions[0];

  try {
    await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        type: "modal",
        callback_id: SUMMARY_MODAL_CALLBACK_ID,
        private_metadata: JSON.stringify({
          channelId: command.channel_id,
          teamId: command.team_id,
          responseUrl: command.response_url,
          period: config.period,
        }),
        title: {
          type: "plain_text",
          text: "Pick repo",
        },
        submit: {
          type: "plain_text",
          text: "Summarise",
        },
        close: {
          type: "plain_text",
          text: "Cancel",
        },
        blocks: [
          {
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
          },
        ],
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

  await maybeSendOnboardingLink(command.user_id, command.team_id, config.created);
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

function formatSummaryQuestionsMessage(input: {
  updateNo: number;
  repo?: string | null;
  summaryPreview?: string | null;
  questions: SummaryQuestion[];
}) {
  const lines = [`Update #${input.updateNo}${input.repo ? ` for ${input.repo}` : ""}`];

  if (input.summaryPreview) {
    lines.push("", "Preview:", input.summaryPreview);
  }

  lines.push("", "I need a few clarifications before I can post the summary.");

  input.questions.forEach((question, index) => {
    lines.push("", `${index + 1}. ${question.message}`);
    if (question.options.length) {
      lines.push(`Options: ${question.options.join(" | ")} | Other`);
    }
  });

  lines.push("", "Reply in this DM with numbered answers, for example:", "1: Completed", "2: e.g. 1~2 seconds to 50ms");

  return lines.join("\n");
}

function parseSummaryAnswersFromMessage(text: string, questions: SummaryQuestion[]) {
  const trimmed = text.trim();
  if (!trimmed) {
    return [] as SummaryAnswer[];
  }

  if (questions.length === 1 && !/^\d+\s*[:.)-]/.test(trimmed)) {
    return [
      {
        message: questions[0].message,
        answer: trimmed,
      },
    ];
  }

  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  const numberedAnswers = new Map<number, string>();

  for (const line of lines) {
    const match = line.match(/^(\d+)\s*[:.)-]\s*(.+)$/);
    if (!match) {
      continue;
    }

    const index = Number(match[1]);
    const answer = match[2]?.trim();
    if (!Number.isInteger(index) || !answer) {
      continue;
    }

    numberedAnswers.set(index, answer);
  }

  if (numberedAnswers.size) {
    return questions
      .map((question, index) => {
        const answer = numberedAnswers.get(index + 1);
        return answer
          ? {
              message: question.message,
              answer,
            }
          : null;
      })
      .filter((answer): answer is SummaryAnswer => Boolean(answer));
  }

  if (lines.length === questions.length) {
    return questions.map((question, index) => ({
      message: question.message,
      answer: lines[index]!,
    }));
  }

  return [] as SummaryAnswer[];
}

function mergeSummaryAnswers(existing: SummaryAnswer[], additions: SummaryAnswer[]) {
  const merged = new Map(existing.map((answer) => [answer.message, answer.answer]));

  for (const answer of additions) {
    merged.set(answer.message, answer.answer);
  }

  return [...merged.entries()].map(([message, answer]) => ({
    message,
    answer,
  }));
}

async function postToResponseUrl(
  responseUrl: string,
  payload: {
    text: string;
    response_type?: "ephemeral" | "in_channel";
    replace_original?: boolean;
    delete_original?: boolean;
  },
) {
  await fetch(responseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

async function sendModalConfirmation(
  client: App["client"],
  channelId: string,
  userId: string,
  text: string,
  responseUrl?: string,
) {
  if (responseUrl) {
    await postToResponseUrl(responseUrl, {
      response_type: "ephemeral",
      text,
      replace_original: false,
    });
    return;
  }

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

async function deliverSummaryOutcome(input: {
  client: App["client"];
  slackUserId: string;
  channelId: string;
  period: SummaryPeriod;
  repo?: string | null;
  responseUrl?: string;
  result: Awaited<ReturnType<typeof generateSummaryResult>> & { ok: true };
}) {
  const { result } = input;

  if (result.summaryResult.questions.length) {
    await createPendingSummarySession({
      userId: result.userId,
      projectId: result.projectId,
      channelId: input.channelId,
      period: input.period,
      updateNo: result.updateNo,
      summaryPreview: result.summaryResult.summary,
      questions: result.summaryResult.questions,
    });

    const dmText = formatSummaryQuestionsMessage({
      updateNo: result.updateNo,
      repo: input.repo ?? null,
      summaryPreview: result.summaryResult.summary,
      questions: result.summaryResult.questions,
    });

    await input.client.chat.postMessage({
      channel: input.slackUserId,
      text: dmText,
    });

    const followUpText = "I need a couple of clarifications before I can post the summary. I sent them in DM.";
    if (input.responseUrl) {
      await postToResponseUrl(input.responseUrl, {
        response_type: "ephemeral",
        text: followUpText,
        replace_original: false,
      });
      return;
    }

    await sendModalConfirmation(input.client, input.channelId, input.slackUserId, followUpText);
    return;
  }

  if (!result.summaryResult.summary) {
    const fallbackText = "I couldn't generate a summary yet. Please try again.";
    if (input.responseUrl) {
      await postToResponseUrl(input.responseUrl, {
        response_type: "ephemeral",
        text: fallbackText,
        replace_original: false,
      });
      return;
    }

    await sendModalConfirmation(input.client, input.channelId, input.slackUserId, fallbackText);
    return;
  }

  await createCompletedSummarySession({
    userId: result.userId,
    projectId: result.projectId,
    channelId: input.channelId,
    period: input.period,
    updateNo: result.updateNo,
    summaryPreview: result.summaryResult.summary,
  });

  if (input.responseUrl) {
    await postToResponseUrl(input.responseUrl, {
      response_type: "in_channel",
      text: result.summaryResult.summary,
      replace_original: false,
    });
    return;
  }

  await input.client.chat.postMessage({
    channel: input.channelId,
    text: result.summaryResult.summary,
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
    .map((project) => buildProjectOption(project));
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
          responseUrl: command.response_url,
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

function resolveDisplayIdFromModal(view: ViewArgs["view"]) {
  const selectedValue =
    view.state.values[ENTRY_SELECT_BLOCK_ID]?.[ENTRY_SELECT_ACTION_ID] &&
    "selected_option" in view.state.values[ENTRY_SELECT_BLOCK_ID][ENTRY_SELECT_ACTION_ID]
      ? view.state.values[ENTRY_SELECT_BLOCK_ID][ENTRY_SELECT_ACTION_ID].selected_option?.value
      : undefined;
  const displayId = Number(selectedValue ?? "");

  return Number.isInteger(displayId) && displayId > 0 ? displayId : null;
}

function resolveEditTextFromModal(view: ViewArgs["view"]) {
  const matchingBlockId = Object.keys(view.state.values).find((blockId) => blockId.startsWith(EDIT_TEXT_BLOCK_ID));
  const matchingActionId = matchingBlockId
    ? Object.keys(view.state.values[matchingBlockId] ?? {}).find((actionId) => actionId.startsWith(EDIT_TEXT_ACTION_ID))
    : undefined;
  const value =
    matchingBlockId &&
    matchingActionId &&
    view.state.values[matchingBlockId]?.[matchingActionId] &&
    "value" in view.state.values[matchingBlockId][matchingActionId]
      ? view.state.values[matchingBlockId][matchingActionId].value
      : "";

  return (value ?? "").trim();
}

function buildEntryManagementModalView(input: {
  callbackId: string;
  title: string;
  submitLabel: string;
  channelId: string;
  teamId: string;
  responseUrl?: string;
  selectedEntry: RecentManualEntry;
  entries: RecentManualEntry[];
  editText?: string;
}) {
  const entryOptions = input.entries.map((entry) => buildEntryOption(entry));
  const initialOption =
    entryOptions.find((option) => option.value === String(input.selectedEntry.displayId)) ?? entryOptions[0];

  const blocks: any[] = [
    {
      type: "input",
      block_id: ENTRY_SELECT_BLOCK_ID,
      dispatch_action: true,
      label: {
        type: "plain_text",
        text: "Entry",
      },
      element: {
        type: "static_select",
        action_id: ENTRY_SELECT_ACTION_ID,
        placeholder: {
          type: "plain_text",
          text: "Pick an entry",
        },
        options: entryOptions,
        ...(initialOption ? { initial_option: initialOption } : {}),
      },
    },
    {
      type: "section",
      block_id: ENTRY_PREVIEW_BLOCK_ID,
      text: {
        type: "mrkdwn",
        text: buildEntryPreviewText(input.selectedEntry),
      },
    },
  ];

  if (input.callbackId === EDIT_MODAL_CALLBACK_ID) {
    blocks.push({
      type: "input",
      block_id: `${EDIT_TEXT_BLOCK_ID}:${input.selectedEntry.displayId}`,
      label: {
        type: "plain_text",
        text: "Updated text",
      },
      element: {
        type: "plain_text_input",
        action_id: `${EDIT_TEXT_ACTION_ID}:${input.selectedEntry.displayId}`,
        multiline: true,
        initial_value: input.editText ?? input.selectedEntry.content,
        placeholder: {
          type: "plain_text",
          text: "Write the replacement text for this entry.",
        },
      },
    });
  }

  return {
    type: "modal" as const,
    callback_id: input.callbackId,
    private_metadata: JSON.stringify({
      channelId: input.channelId,
      teamId: input.teamId,
      responseUrl: input.responseUrl,
      selectedDisplayId: input.selectedEntry.displayId,
    }),
    title: {
      type: "plain_text" as const,
      text: input.title,
    },
    submit: {
      type: "plain_text" as const,
      text: input.submitLabel,
    },
    close: {
      type: "plain_text" as const,
      text: "Cancel",
    },
    blocks,
  };
}

async function openEditModal(args: CommandArgs) {
  const { command, ack, client, respond } = args;
  await ack();

  const defaultRepo = (await resolveDefaultRepo(command.user_id)) ?? null;
  const parsed = parseEditArgs(command.text ?? "", defaultRepo);
  const entries = await listRecentManualEntries(command.user_id, 25);

  if (!entries.length) {
    await respond({
      response_type: "ephemeral",
      text: "No editable entries found yet.",
    });
    return;
  }

  const initialEntry = entries.find((entry) => entry.displayId === parsed?.displayId) ?? entries[0];
  await client.views.open({
    trigger_id: command.trigger_id,
    view: buildEntryManagementModalView({
      callbackId: EDIT_MODAL_CALLBACK_ID,
      title: "Edit entry",
      submitLabel: "Save",
      channelId: command.channel_id,
      teamId: command.team_id,
      responseUrl: command.response_url,
      selectedEntry: initialEntry,
      entries,
      editText: parsed?.text || initialEntry.content,
    }),
  });
}

async function openDeleteModal(args: CommandArgs) {
  const { command, ack, client, respond } = args;
  await ack();

  const defaultRepo = (await resolveDefaultRepo(command.user_id)) ?? null;
  const parsed = parseDeleteArgs(command.text ?? "", defaultRepo);
  const entries = await listRecentManualEntries(command.user_id, 25);

  if (!entries.length) {
    await respond({
      response_type: "ephemeral",
      text: "No deletable entries found yet.",
    });
    return;
  }

  const initialEntry = entries.find((entry) => entry.displayId === parsed?.displayId) ?? entries[0];
  await client.views.open({
    trigger_id: command.trigger_id,
    view: buildEntryManagementModalView({
      callbackId: DELETE_MODAL_CALLBACK_ID,
      title: "Delete entry",
      submitLabel: "Delete",
      channelId: command.channel_id,
      teamId: command.team_id,
      responseUrl: command.response_url,
      selectedEntry: initialEntry,
      entries,
    }),
  });
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
    responseUrl?: string;
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
    metadata.responseUrl,
  );
}

export async function handleEdit(args: CommandArgs) {
  await openEditModal(args);
}

export async function handleDelete(args: CommandArgs) {
  await openDeleteModal(args);
}

export async function handleEditModalSubmission(args: ViewArgs) {
  const { ack, body, client, view } = args;
  const content = resolveEditTextFromModal(view);

  if (!content) {
    await ack({
      response_action: "errors",
      errors: {
        [EDIT_TEXT_BLOCK_ID]: "Please enter the updated text.",
      },
    });
    return;
  }

  await ack();

  const metadata = JSON.parse(view.private_metadata || "{}") as {
    channelId?: string;
    responseUrl?: string;
  };
  const displayId = resolveDisplayIdFromModal(view);
  const channelId = metadata.channelId ?? body.user.id;

  if (!displayId) {
    await sendModalConfirmation(client, channelId, body.user.id, "Please choose an entry to edit.", metadata.responseUrl);
    return;
  }

  const entry = await editManualEntry(body.user.id, displayId, content);
  if (!entry) {
    await sendModalConfirmation(
      client,
      channelId,
      body.user.id,
      `I couldn't find editable entry #${displayId}.`,
      metadata.responseUrl,
    );
    return;
  }

  await sendModalConfirmation(
    client,
    channelId,
    body.user.id,
    `✏️ Updated #${entry.displayId}: _"${entry.content}"_`,
    metadata.responseUrl,
  );
}

export async function handleDeleteModalSubmission(args: ViewArgs) {
  const { ack, body, client, view } = args;
  await ack();

  const metadata = JSON.parse(view.private_metadata || "{}") as {
    channelId?: string;
    responseUrl?: string;
  };
  const displayId = resolveDisplayIdFromModal(view);
  const channelId = metadata.channelId ?? body.user.id;

  if (!displayId) {
    await sendModalConfirmation(client, channelId, body.user.id, "Please choose an entry to delete.", metadata.responseUrl);
    return;
  }

  const entry = await deleteManualEntry(body.user.id, displayId);
  if (!entry) {
    await sendModalConfirmation(
      client,
      channelId,
      body.user.id,
      `I couldn't find deletable entry #${displayId}.`,
      metadata.responseUrl,
    );
    return;
  }

  await sendModalConfirmation(
    client,
    channelId,
    body.user.id,
    `🗑️ Deleted #${entry.displayId}: _"${entry.content}"_`,
    metadata.responseUrl,
  );
}

export async function handleEntrySelectionChange(args: ActionArgs) {
  const { ack, body, client } = args;
  await ack();

  if (!body.view || (body.view.callback_id !== EDIT_MODAL_CALLBACK_ID && body.view.callback_id !== DELETE_MODAL_CALLBACK_ID)) {
    return;
  }

  const entries = await listRecentManualEntries(body.user.id, 25);
  if (!entries.length) {
    return;
  }

  const action = body.actions[0];
  const selectedDisplayId =
    action && "selected_option" in action ? Number(action.selected_option?.value ?? "") : Number.NaN;
  const nextEntry = entries.find((entry) => entry.displayId === selectedDisplayId) ?? entries[0];
  const metadata = JSON.parse(body.view.private_metadata || "{}") as {
    channelId?: string;
    teamId?: string;
    responseUrl?: string;
    selectedDisplayId?: number;
  };

  await client.views.update({
    view_id: body.view.id,
    hash: body.view.hash,
    view: buildEntryManagementModalView({
      callbackId: body.view.callback_id,
      title: body.view.callback_id === EDIT_MODAL_CALLBACK_ID ? "Edit entry" : "Delete entry",
      submitLabel: body.view.callback_id === EDIT_MODAL_CALLBACK_ID ? "Save" : "Delete",
      channelId: metadata.channelId ?? body.user.id,
      teamId: metadata.teamId ?? body.team?.id ?? "",
      responseUrl: metadata.responseUrl,
      selectedEntry: nextEntry,
      entries,
      editText: body.view.callback_id === EDIT_MODAL_CALLBACK_ID ? nextEntry.content : undefined,
    }),
  });
}

export async function handleSummarise(args: CommandArgs) {
  const { command, ack, respond, client } = args;
  await ack();
  const { repo, period } = parseSummaryArgs(command.text ?? "");

  if (!repo) {
    const { created, user } = await loadUserForEntryModal(command.user_id, command.team_id);
    const selection = await determineSummaryRepoSelection(command.user_id, period, user);

    if (selection.type === "modal") {
      await openSummaryModal(args, {
        period,
        repoNames: selection.repoNames,
        created,
        user,
      });
      return;
    }

    await respond({
      response_type: "ephemeral",
      text: "⏳ Generating your standup summary...",
    });

    const resolved = await generateSummaryResult({
      slackUserId: command.user_id,
      slackTeamId: command.team_id,
      period,
      repo: selection.type === "single" ? selection.repo : null,
    });

    if (created) {
      await maybeSendOnboardingLink(command.user_id, command.team_id, true);
    }

    if (!resolved.ok) {
      await respond({
        response_type: "ephemeral",
        text: resolved.text,
      });
      return;
    }

    await deliverSummaryOutcome({
      client,
      slackUserId: command.user_id,
      channelId: command.channel_id,
      period,
      repo: selection.type === "single" ? selection.repo : null,
      responseUrl: command.response_url,
      result: resolved,
    });
    return;
  }

  await respond({
    response_type: "ephemeral",
    text: "⏳ Generating your standup summary...",
  });

  const resolved = await generateSummaryResult({
    slackUserId: command.user_id,
    slackTeamId: command.team_id,
    period,
    repo,
  });

  if (!resolved.ok) {
    await respond({
      response_type: "ephemeral",
      text: resolved.text,
    });
    return;
  }

  await deliverSummaryOutcome({
    client,
    slackUserId: command.user_id,
    channelId: command.channel_id,
    period,
    repo,
    responseUrl: command.response_url,
    result: resolved,
  });
}

export async function handleSummaryModalSubmission(args: ViewArgs) {
  const { ack, body, client, view } = args;
  await ack();

  const metadata = JSON.parse(view.private_metadata || "{}") as {
    channelId?: string;
    teamId?: string;
    responseUrl?: string;
    period?: SummaryPeriod;
  };
  const repo = resolveRepoFromModal(view);
  const channelId = metadata.channelId ?? body.user.id;

  if (!repo) {
    await sendModalConfirmation(
      client,
      channelId,
      body.user.id,
      "Please choose a repo before generating the summary.",
      metadata.responseUrl,
    );
    return;
  }

  const resolved = await generateSummaryResult({
    slackUserId: body.user.id,
    slackTeamId: metadata.teamId ?? body.team?.id ?? "",
    period: metadata.period === "week" ? "week" : "today",
    repo,
  });

  if (!resolved.ok) {
    await sendModalConfirmation(client, channelId, body.user.id, resolved.text, metadata.responseUrl);
    return;
  }

  await deliverSummaryOutcome({
    client,
    slackUserId: body.user.id,
    channelId,
    period: metadata.period === "week" ? "week" : "today",
    repo,
    responseUrl: metadata.responseUrl,
    result: resolved,
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

async function handlePendingSummarySessionReply(app: App, userId: string, teamId: string, text: string) {
  await ensureSlackUser(userId, teamId);
  const user = await getUserContextBySlackId(userId);
  if (!user) {
    return false;
  }

  const session = await getPendingSummarySession(user.id);
  if (!session) {
    return false;
  }

  const questions = Array.isArray(session.questions)
    ? (session.questions as unknown as SummaryQuestion[])
    : [];
  const existingAnswers = Array.isArray(session.answers)
    ? (session.answers as unknown as SummaryAnswer[])
    : [];
  const newAnswers = parseSummaryAnswersFromMessage(text, questions);

  if (!newAnswers.length) {
    await app.client.chat.postMessage({
      channel: userId,
      text: `${formatSummaryQuestionsMessage({
        updateNo: session.updateNo,
        repo: session.project?.githubRepo ?? null,
        summaryPreview: session.summaryPreview,
        questions,
      })}\n\nI couldn't match that reply to the numbered questions yet.`,
    });
    return true;
  }

  const mergedAnswers = mergeSummaryAnswers(existingAnswers, newAnswers);
  const unansweredQuestions = questions.filter(
    (question) => !mergedAnswers.some((answer) => answer.message === question.message),
  );

  if (unansweredQuestions.length) {
    await updatePendingSummarySession(session.id, {
      summaryPreview: session.summaryPreview,
      questions: unansweredQuestions,
      answers: mergedAnswers,
    });

    await app.client.chat.postMessage({
      channel: userId,
      text: formatSummaryQuestionsMessage({
        updateNo: session.updateNo,
        repo: session.project?.githubRepo ?? null,
        summaryPreview: session.summaryPreview,
        questions: unansweredQuestions,
      }),
    });
    return true;
  }

  const resolved = await generateSummaryResult({
    slackUserId: userId,
    slackTeamId: teamId,
    period: session.period === "week" ? "week" : "today",
    repo: session.project?.githubRepo ?? null,
    updateNo: session.updateNo,
    answers: mergedAnswers,
  });

  if (!resolved.ok) {
    await expireSummarySession(session.id);
    await app.client.chat.postMessage({
      channel: userId,
      text: resolved.text,
    });
    return true;
  }

  if (resolved.summaryResult.questions.length) {
    await updatePendingSummarySession(session.id, {
      summaryPreview: resolved.summaryResult.summary,
      questions: resolved.summaryResult.questions,
      answers: mergedAnswers,
    });

    await app.client.chat.postMessage({
      channel: userId,
      text: formatSummaryQuestionsMessage({
        updateNo: resolved.updateNo,
        repo: session.project?.githubRepo ?? null,
        summaryPreview: resolved.summaryResult.summary,
        questions: resolved.summaryResult.questions,
      }),
    });
    return true;
  }

  await completeSummarySession(session.id);

  if (resolved.summaryResult.summary) {
    await app.client.chat.postMessage({
      channel: session.channelId,
      text: resolved.summaryResult.summary,
    });
  }

  await app.client.chat.postMessage({
    channel: userId,
    text: `Posted Update #${resolved.updateNo}${session.project?.githubRepo ? ` for ${session.project.githubRepo}` : ""}.`,
  });
  return true;
}

export async function handleDirectMessage(app: App, userId: string, text: string) {
  const info = await app.client.users.info({ user: userId });
  const teamId = info.user?.team_id;
  if (!teamId) {
    return;
  }

  if (await handlePendingSummarySessionReply(app, userId, teamId, text)) {
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

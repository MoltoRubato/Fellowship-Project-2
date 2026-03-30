import type { App } from "@slack/bolt";
import type { CommandModule, CommandArgs, ViewArgs, ActionArgs, SummaryPeriod } from "./types.js";
import {
  SUMMARY_MODAL_CALLBACK_ID,
  SUMMARY_REPO_PICK_ACTION_ID,
  REPO_SELECT_BLOCK_ID,
  REPO_SELECT_ACTION_ID,
  buildProjectOption,
  sortProjectsForRepoPicker,
  sortRepoNamesForRepoPicker,
  getMostRecentlyUpdatedRepo,
  parseSummaryArgs,
  resolveRepoFromModal,
  loadUserForEntryModal,
  maybeSendOnboardingLink,
  postToResponseUrl,
  sendModalConfirmation,
} from "./shared.js";
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
  ensureSlackUser,
  getUserContextBySlackId,
  listActiveBlockers,
  listEntriesSince,
  syncConnectedActivity,
  type UserContext,
} from "@/server/services/standup";

// ── Summary internals ────────────────────────────────────────────────

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
  skipSync?: boolean;
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

  if (!input.skipSync) {
    try {
      await syncConnectedActivity(user, since);
    } catch (error) {
      console.error("Activity sync failed", error);
    }
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
        replace_original: true,
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
        replace_original: true,
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
      replace_original: true,
    });
    return;
  }

  await input.client.chat.postMessage({
    channel: input.channelId,
    text: result.summaryResult.summary,
  });
}

// ── DM follow-up questions ───────────────────────────────────────────

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

export async function handlePendingSummarySessionReply(app: App, userId: string, teamId: string, text: string) {
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

// ── Command handler ──────────────────────────────────────────────────

async function handleSummarise(args: CommandArgs) {
  const { command, ack, respond, client } = args;
  await ack();
  const { repo, period } = parseSummaryArgs(command.text ?? "");

  if (!repo) {
    const { created, user } = await loadUserForEntryModal(command.user_id, command.team_id);

    await respond({
      response_type: "ephemeral",
      text: "⏳ Generating your standup summary...",
    });

    if (user) {
      const since = getSummaryWindow(period);
      try {
        await syncConnectedActivity(user, since);
      } catch (error) {
        console.error("Pre-selection activity sync failed", error);
      }
    }

    const selection = await determineSummaryRepoSelection(command.user_id, period, user);

    if (selection.type === "modal") {
      await respond({
        response_type: "ephemeral",
        text: "Pick a repo to summarise:",
        replace_original: true,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "Pick a repo to summarise:" },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Pick repo" },
                action_id: SUMMARY_REPO_PICK_ACTION_ID,
                value: JSON.stringify({
                  repoNames: selection.repoNames,
                  period,
                  channelId: command.channel_id,
                  teamId: command.team_id,
                  created,
                }),
              },
            ],
          },
        ],
      });
      return;
    }

    const resolved = await generateSummaryResult({
      slackUserId: command.user_id,
      slackTeamId: command.team_id,
      period,
      repo: selection.type === "single" ? selection.repo : null,
      skipSync: true,
    });

    if (created) {
      await maybeSendOnboardingLink(command.user_id, command.team_id, true);
    }

    if (!resolved.ok) {
      await respond({
        response_type: "ephemeral",
        text: resolved.text,
        replace_original: true,
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
      replace_original: true,
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

async function handleSummaryRepoPick(args: ActionArgs) {
  const { ack, body, client, action } = args;
  await ack();

  const value = JSON.parse((action as { value?: string }).value ?? "{}") as {
    repoNames?: string[];
    period?: SummaryPeriod;
    channelId?: string;
    teamId?: string;
    created?: boolean;
  };
  const repoNames = value.repoNames ?? [];
  const period = value.period ?? "today";
  const slackUserId = body.user.id;
  const teamId = value.teamId ?? body.team?.id ?? body.user.team_id ?? "";
  const channelId = value.channelId ?? body.channel?.id ?? slackUserId;
  const responseUrl = (body as { response_url?: string }).response_url;

  const user = await getUserContextBySlackId(slackUserId);
  const orderedRepoNames = sortRepoNamesForRepoPicker(repoNames, user);
  const projectByRepo = new Map((user?.projects ?? []).map((p) => [p.githubRepo, p]));
  const repoOptions = orderedRepoNames.map((repo) => {
    const project = projectByRepo.get(repo);
    return project ? buildProjectOption(project) : buildProjectOption({ githubRepo: repo });
  });
  const defaultRepo = getMostRecentlyUpdatedRepo(user);
  const initialRepo =
    repoOptions.find((option) => option.value === defaultRepo) ?? repoOptions[0];

  const triggerId = body.trigger_id;
  if (!triggerId) {
    return;
  }

  try {
    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: "modal",
        callback_id: SUMMARY_MODAL_CALLBACK_ID,
        private_metadata: JSON.stringify({
          channelId,
          teamId,
          responseUrl,
          period,
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
  } catch {
    if (responseUrl) {
      await postToResponseUrl(responseUrl, {
        response_type: "ephemeral",
        text: "Failed to open the repo picker. Please try `/summarise` again.",
        replace_original: true,
      });
    }
  }
}

async function handleSummaryModalSubmission(args: ViewArgs) {
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

  if (metadata.responseUrl) {
    await postToResponseUrl(metadata.responseUrl, {
      response_type: "ephemeral",
      text: "⏳ Generating your standup summary...",
      replace_original: true,
    });
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

const summary: CommandModule = {
  name: "summary",
  register(app) {
    app.command("/summarise", handleSummarise);
    app.view(SUMMARY_MODAL_CALLBACK_ID, handleSummaryModalSubmission);
    app.action(SUMMARY_REPO_PICK_ACTION_ID, handleSummaryRepoPick);
  },
};

export default summary;

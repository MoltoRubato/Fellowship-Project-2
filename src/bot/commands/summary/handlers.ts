import type { CommandArgs, ViewArgs, ActionArgs, SummaryPeriod } from "../types.js";
import {
  SUMMARY_MODAL_CALLBACK_ID,
  SUMMARY_REPO_PICK_ACTION_ID,
  REPO_SELECT_BLOCK_ID,
  REPO_SELECT_ACTION_ID,
  buildProjectOption,
  sortRepoNamesForRepoPicker,
  parseSummaryArgs,
  resolveRepoFromModal,
  loadUserForEntryModal,
  maybeSendOnboardingLink,
  postToResponseUrl,
  sendModalConfirmation,
} from "../shared/index.js";
import {
  getSummarySyncSince,
} from "@/server/services/summary";
import {
  getUserContextBySlackId,
  syncConnectedActivity,
  getLastSelfActionedRepo,
} from "@/server/services/standup";
import { determineSummaryRepoSelection } from "./repo-selection";
import { generateSummaryResult } from "./generate-result";
import { deliverSummaryOutcome } from "./deliver";

export async function handleSummarise(args: CommandArgs) {
  const { command, ack, respond, client } = args;
  await ack();
  const { repo, period } = parseSummaryArgs(command.text ?? "");

  if (!repo) {
    const { created, user } = await loadUserForEntryModal(command.user_id, command.team_id);

    await respond({
      response_type: "ephemeral",
      text: "Generating your standup summary...",
    });

    if (user) {
      const since = getSummarySyncSince(period);
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
    text: "Generating your standup summary...",
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

export async function handleSummaryRepoPick(args: ActionArgs) {
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
  const defaultRepo = await getLastSelfActionedRepo(slackUserId);
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

  if (metadata.responseUrl) {
    await postToResponseUrl(metadata.responseUrl, {
      response_type: "ephemeral",
      text: "Generating your standup summary...",
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

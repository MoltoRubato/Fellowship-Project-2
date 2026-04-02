import type { CommandArgs, ViewArgs, ActionArgs, SummaryPeriod } from "../types.js";
import {
  SUMMARY_MODAL_CALLBACK_ID,
  SUMMARY_REPO_PICK_ACTION_ID,
  REPO_SELECT_BLOCK_ID,
  REPO_SELECT_ACTION_ID,
  SUMMARY_REPOS_SELECT_BLOCK_ID,
  SUMMARY_REPOS_SELECT_ACTION_ID,
  SUMMARY_ALL_REPOS_OPTION_VALUE,
  buildProjectOption,
  sortRepoNamesForRepoPicker,
  parseSummaryArgs,
  resolveRepoFromModal,
  resolveSummaryReposFromModal,
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
  listEntriesForSummaryPeriod,
} from "@/server/services/standup";
import { generateSummaryResult } from "./generate-result";
import { deliverSummaryOutcome } from "./deliver";

export async function handleSummarise(args: CommandArgs) {
  const { command, ack, respond, client } = args;
  await ack();
  const { repos, period } = parseSummaryArgs(command.text ?? "");
  const triggerId = command.trigger_id;
  if (!triggerId) {
    await respond({
      response_type: "ephemeral",
      text: "I couldn't open the summary picker. Please try `/summarise` again.",
    });
    return;
  }

  const { created, user } = await loadUserForEntryModal(command.user_id, command.team_id);
  const entries = await listEntriesForSummaryPeriod(command.user_id, period);
  const activeRepos = entries
    .map((entry) => entry.project?.githubRepo ?? null)
    .filter((repo): repo is string => Boolean(repo));
  const fallbackRepos = (user?.projects ?? []).map((project) => project.githubRepo);
  const repoNames = sortRepoNamesForRepoPicker(
    [...new Set([...(activeRepos.length ? activeRepos : fallbackRepos), ...repos])],
    user,
  );
  const projectByRepo = new Map((user?.projects ?? []).map((project) => [project.githubRepo, project]));
  const allReposOption = {
    text: { type: "plain_text" as const, text: "All repos" },
    value: SUMMARY_ALL_REPOS_OPTION_VALUE,
  };
  const repoOptions = repoNames.map((repo) => {
    const project = projectByRepo.get(repo);
    return project ? buildProjectOption(project) : buildProjectOption({ githubRepo: repo });
  });
  const initialRepoOptions = repos.length
    ? repoOptions.filter((option) => repos.includes(option.value))
    : [allReposOption];

  try {
    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: "modal",
        callback_id: SUMMARY_MODAL_CALLBACK_ID,
        private_metadata: JSON.stringify({
          channelId: command.channel_id,
          teamId: command.team_id,
          responseUrl: command.response_url,
          period,
          created,
        }),
        title: {
          type: "plain_text",
          text: "Summarise",
        },
        submit: {
          type: "plain_text",
          text: "Generate",
        },
        close: {
          type: "plain_text",
          text: "Cancel",
        },
        blocks: [
          {
            type: "input",
            block_id: SUMMARY_REPOS_SELECT_BLOCK_ID,
            optional: true,
            label: {
              type: "plain_text",
              text: "Repos",
            },
            hint: {
              type: "plain_text",
              text: "All repos is selected by default. Choose one or more repos to narrow the summary.",
            },
            element: {
              type: "multi_static_select",
              action_id: SUMMARY_REPOS_SELECT_ACTION_ID,
              placeholder: {
                type: "plain_text",
                text: "Select repos",
              },
              options: [allReposOption, ...repoOptions],
              initial_options: initialRepoOptions,
            },
          },
        ],
      },
    });
  } catch (error) {
    console.error("Failed to open summary modal", error);
    await respond({
      response_type: "ephemeral",
      text: "I couldn't open the summary picker. Please try `/summarise` again.",
    });
  }
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
    created?: boolean;
  };
  const repos =
    SUMMARY_REPOS_SELECT_BLOCK_ID in view.state.values
      ? resolveSummaryReposFromModal(view)
      : (() => {
          const repo = resolveRepoFromModal(view);
          return repo ? [repo] : null;
        })();
  const channelId = metadata.channelId ?? body.user.id;

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
    repos,
  });

  if (metadata.created) {
    await maybeSendOnboardingLink(body.user.id, metadata.teamId ?? body.team?.id ?? "", true);
  }

  if (!resolved.ok) {
    await sendModalConfirmation(client, channelId, body.user.id, resolved.text, metadata.responseUrl);
    return;
  }

  await deliverSummaryOutcome({
    client,
    slackUserId: body.user.id,
    channelId,
    period: metadata.period === "week" ? "week" : "today",
    repos,
    responseUrl: metadata.responseUrl,
    result: resolved,
  });
}

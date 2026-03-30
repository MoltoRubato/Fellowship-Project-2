import { EntrySource, EntryType } from "@prisma/client";
import type { CommandModule, CommandArgs, ViewArgs } from "./types.js";
import {
  ENTRY_MODAL_CALLBACK_ID,
  REPO_SELECT_BLOCK_ID,
  REPO_SELECT_ACTION_ID,
  REPO_INPUT_BLOCK_ID,
  REPO_INPUT_ACTION_ID,
  MESSAGE_BLOCK_ID,
  MESSAGE_ACTION_ID,
  buildProjectOption,
  sortProjectsForRepoPicker,
  getMostRecentlyUpdatedRepo,
  parseRepoAndText,
  resolveRepoFromModal,
  loadUserForEntryModal,
  maybeSendOnboardingLink,
  sendModalConfirmation,
} from "./shared.js";
import { logEntry } from "@/server/services/standup";
import type { ModalEntryType } from "./types.js";

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

async function handleEntryModalSubmission(args: ViewArgs) {
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

const entries: CommandModule = {
  name: "entries",
  register(app) {
    app.command("/did", async (args) => {
      await openEntryModal(args, {
        entryType: "update",
        title: "Log work update",
        submitLabel: "Log update",
        messageLabel: "What did you work on?",
        messagePlaceholder: "Finished the auth callback flow and verified the dashboard.",
      });
    });

    app.command("/blocker", async (args) => {
      await openEntryModal(args, {
        entryType: "blocker",
        title: "Log blocker",
        submitLabel: "Log blocker",
        messageLabel: "What is blocking you?",
        messagePlaceholder: "Waiting on GitHub OAuth callback URL to be updated.",
      });
    });

    app.view(ENTRY_MODAL_CALLBACK_ID, handleEntryModalSubmission);
  },
};

export default entries;

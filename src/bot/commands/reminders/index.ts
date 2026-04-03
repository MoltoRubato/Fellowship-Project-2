import type { BlockAction } from "@slack/bolt";
import type { ActionArgs, CommandArgs, CommandModule, ViewArgs } from "../types";
import { postToResponseUrl } from "../shared";
import {
  getReminderSettings,
  setReminderPreference,
  updateReminderSchedule,
} from "@/server/services/standup";
import {
  REMINDERS_CONFIGURE_ACTION_ID,
  REMINDERS_CONFIG_MODAL_CALLBACK_ID,
  REMINDERS_TOGGLE_ACTION_ID,
} from "./constants";
import { buildReminderStatusMessage } from "./formatting";
import {
  buildReminderConfigModal,
  parseReminderConfigView,
  parseReminderModalMetadata,
} from "./modal";

function parseReminderCommand(text: string) {
  const normalized = text.trim().toLowerCase();

  if (!normalized) {
    return "status" as const;
  }

  if (normalized === "on" || normalized === "off") {
    return normalized;
  }

  return "invalid" as const;
}

function resolveTeamId(body: {
  team: { id: string } | null;
  user: { team_id?: string };
}) {
  return body.team?.id ?? body.user.team_id ?? "";
}

function isExpiredTriggerError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof (error as { data?: { error?: string } }).data?.error === "string" &&
    (error as { data?: { error?: string } }).data?.error === "expired_trigger_id"
  );
}

const reminders: CommandModule = {
  name: "reminders",
  register(app) {
    app.command("/reminders", handleRemindersCommand);
    app.action<BlockAction>(REMINDERS_TOGGLE_ACTION_ID, handleReminderToggleAction);
    app.action<BlockAction>(REMINDERS_CONFIGURE_ACTION_ID, handleReminderConfigureAction);
    app.view(REMINDERS_CONFIG_MODAL_CALLBACK_ID, handleReminderConfigSubmission);
  },
};

export default reminders;

export async function handleRemindersCommand({
  command,
  ack,
  respond,
}: CommandArgs) {
  await ack();

  const parsed = parseReminderCommand(command.text ?? "");

  if (parsed === "invalid") {
    await respond({
      response_type: "ephemeral",
      text: "Use `/reminders`, `/reminders on`, or `/reminders off`.",
    });
    return;
  }

  const settings =
    parsed === "status"
      ? await getReminderSettings(command.user_id, command.team_id)
      : await setReminderPreference({
          slackUserId: command.user_id,
          slackTeamId: command.team_id,
          remindersEnabled: parsed === "on",
        });
  const status = buildReminderStatusMessage(settings);

  await respond({
    response_type: "ephemeral",
    text: status.text,
    blocks: status.blocks,
  });
}

export async function handleReminderToggleAction({
  ack,
  body,
  action,
}: ActionArgs) {
  await ack();

  const teamId = resolveTeamId(body);
  const nextValue =
    "value" in action
      ? action.value === "on"
        ? true
        : action.value === "off"
          ? false
          : null
      : null;

  if (!teamId || nextValue === null) {
    await postToResponseUrl(body.response_url, {
      response_type: "ephemeral",
      replace_original: true,
      text: "I couldn't update your reminder setting. Please run `/reminders on` or `/reminders off` again.",
    });
    return;
  }

  const settings = await setReminderPreference({
    slackUserId: body.user.id,
    slackTeamId: teamId,
    remindersEnabled: nextValue,
  });
  const status = buildReminderStatusMessage(settings);

  await postToResponseUrl(body.response_url, {
    response_type: "ephemeral",
    replace_original: true,
    text: status.text,
    blocks: status.blocks,
  });
}

export async function handleReminderConfigureAction({
  ack,
  body,
  client,
}: ActionArgs) {
  await ack();

  const teamId = resolveTeamId(body);

  if (!teamId) {
    await postToResponseUrl(body.response_url, {
      response_type: "ephemeral",
      replace_original: false,
      text: "I couldn't open reminder settings. Please try `/reminders` again.",
    });
    return;
  }

  const settings = await getReminderSettings(body.user.id, teamId);

  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildReminderConfigModal({
        settings,
        responseUrl: body.response_url,
        teamId,
      }),
    });
  } catch (error) {
    if (isExpiredTriggerError(error)) {
      await postToResponseUrl(body.response_url, {
        response_type: "ephemeral",
        replace_original: false,
        text: "The reminder settings modal took too long to open. Please run `/reminders` again.",
      });
      return;
    }

    throw error;
  }
}

export async function handleReminderConfigSubmission({
  ack,
  body,
  view,
}: ViewArgs) {
  const { reminderDays, reminderSlots } = parseReminderConfigView(view);
  const errors: Record<string, string> = {};

  if (!reminderDays.length) {
    errors.reminders_days = "Select at least one day.";
  }

  if (!reminderSlots.length) {
    errors.reminders_slots = "Select at least one reminder type.";
  }

  if (Object.keys(errors).length) {
    await ack({
      response_action: "errors",
      errors,
    });
    return;
  }

  await ack();

  const metadata = parseReminderModalMetadata(view.private_metadata);
  const teamId = metadata.teamId ?? body.team?.id ?? "";
  const settings = await updateReminderSchedule({
    slackUserId: body.user.id,
    slackTeamId: teamId,
    reminderDays,
    reminderSlots,
  });

  if (!metadata.responseUrl) {
    return;
  }

  const status = buildReminderStatusMessage(settings);
  await postToResponseUrl(metadata.responseUrl, {
    response_type: "ephemeral",
    replace_original: true,
    text: status.text,
    blocks: status.blocks,
  });
}

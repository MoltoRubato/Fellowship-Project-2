import type { Block, KnownBlock } from "@slack/types";
import {
  REMINDER_DAY_DEFINITIONS,
  REMINDER_SLOT_DEFINITIONS,
  type ReminderDayKey,
  type ReminderSlotKey,
} from "@/lib/reminders";
import type { ReminderSettings } from "@/server/services/standup/reminders";
import {
  REMINDERS_CONFIG_MODAL_CALLBACK_ID,
  REMINDERS_DAYS_ACTION_ID,
  REMINDERS_DAYS_BLOCK_ID,
  REMINDERS_SLOTS_ACTION_ID,
  REMINDERS_SLOTS_BLOCK_ID,
} from "./constants";

type ReminderModalMetadata = {
  responseUrl?: string;
  teamId?: string;
};

type ReminderConfigView = {
  private_metadata?: string;
  state: {
    values: Record<string, Record<string, unknown>>;
  };
};

function buildCheckboxOption(label: string, value: string) {
  return {
    text: {
      type: "plain_text" as const,
      text: label,
    },
    value,
  };
}

function getSelectedOptionValues(view: ReminderConfigView, blockId: string, actionId: string) {
  const actionState = view.state.values[blockId]?.[actionId];

  if (
    !actionState ||
    typeof actionState !== "object" ||
    actionState === null ||
    !("selected_options" in actionState) ||
    !Array.isArray(actionState.selected_options)
  ) {
    return [];
  }

  return actionState.selected_options.map((option) => option.value);
}

export function buildReminderConfigModal(input: {
  settings: ReminderSettings;
  responseUrl?: string;
  teamId?: string;
}) {
  const selectedDays = new Set(input.settings.reminderDays);
  const selectedSlots = new Set(input.settings.reminderSlots);

  const blocks: (KnownBlock | Block)[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Choose which days and which reminder types you want. Times follow your current Slack timezone.",
      },
    },
    {
      type: "input",
      optional: true,
      block_id: REMINDERS_DAYS_BLOCK_ID,
      label: {
        type: "plain_text",
        text: "Days",
      },
      element: {
        type: "checkboxes",
        action_id: REMINDERS_DAYS_ACTION_ID,
        options: REMINDER_DAY_DEFINITIONS.map((day) => buildCheckboxOption(day.longLabel, day.key)),
        initial_options: REMINDER_DAY_DEFINITIONS.filter((day) => selectedDays.has(day.key)).map((day) =>
          buildCheckboxOption(day.longLabel, day.key),
        ),
      },
    },
    {
      type: "input",
      optional: true,
      block_id: REMINDERS_SLOTS_BLOCK_ID,
      label: {
        type: "plain_text",
        text: "Reminder types",
      },
      element: {
        type: "checkboxes",
        action_id: REMINDERS_SLOTS_ACTION_ID,
        options: REMINDER_SLOT_DEFINITIONS.map((slot) =>
          buildCheckboxOption(`${slot.label} (${slot.scheduleLabel})`, slot.key),
        ),
        initial_options: REMINDER_SLOT_DEFINITIONS.filter((slot) => selectedSlots.has(slot.key)).map((slot) =>
          buildCheckboxOption(`${slot.label} (${slot.scheduleLabel})`, slot.key),
        ),
      },
    },
  ];

  return {
    type: "modal" as const,
    callback_id: REMINDERS_CONFIG_MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify({
      responseUrl: input.responseUrl,
      teamId: input.teamId,
    } satisfies ReminderModalMetadata),
    title: {
      type: "plain_text" as const,
      text: "Reminder settings",
    },
    submit: {
      type: "plain_text" as const,
      text: "Save",
    },
    close: {
      type: "plain_text" as const,
      text: "Cancel",
    },
    blocks,
  };
}

export function parseReminderConfigView(view: ReminderConfigView) {
  return {
    reminderDays: getSelectedOptionValues(view, REMINDERS_DAYS_BLOCK_ID, REMINDERS_DAYS_ACTION_ID) as ReminderDayKey[],
    reminderSlots: getSelectedOptionValues(view, REMINDERS_SLOTS_BLOCK_ID, REMINDERS_SLOTS_ACTION_ID) as ReminderSlotKey[],
  };
}

export function parseReminderModalMetadata(privateMetadata: string | undefined): ReminderModalMetadata {
  if (!privateMetadata) {
    return {};
  }

  try {
    return JSON.parse(privateMetadata) as ReminderModalMetadata;
  } catch {
    return {};
  }
}

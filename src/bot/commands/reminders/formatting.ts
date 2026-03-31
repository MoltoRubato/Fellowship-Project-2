import type { Block, KnownBlock } from "@slack/types";
import {
  REMINDER_DAY_DEFINITIONS,
  REMINDER_SLOT_DEFINITIONS,
  type ReminderDayKey,
  type ReminderSlotKey,
} from "@/lib/reminders";
import type { ReminderSettings } from "@/server/services/standup/reminders";
import { REMINDERS_CONFIGURE_ACTION_ID, REMINDERS_TOGGLE_ACTION_ID } from "./constants";

function formatDayRange(startDay: ReminderDayKey, endDay: ReminderDayKey) {
  const startLabel = REMINDER_DAY_DEFINITIONS.find((day) => day.key === startDay)?.shortLabel ?? startDay;
  const endLabel = REMINDER_DAY_DEFINITIONS.find((day) => day.key === endDay)?.shortLabel ?? endDay;

  return startDay === endDay ? startLabel : `${startLabel}-${endLabel}`;
}

export function formatReminderDays(reminderDays: ReminderDayKey[]) {
  if (!reminderDays.length) {
    return "None selected";
  }

  if (reminderDays.length === REMINDER_DAY_DEFINITIONS.length) {
    return "Every day";
  }

  const orderedIndices = reminderDays
    .map((day) => REMINDER_DAY_DEFINITIONS.findIndex((entry) => entry.key === day))
    .filter((index) => index >= 0);

  const ranges: string[] = [];
  let rangeStart = orderedIndices[0];
  let rangeEnd = orderedIndices[0];

  for (let index = 1; index < orderedIndices.length; index += 1) {
    const current = orderedIndices[index];

    if (current === rangeEnd + 1) {
      rangeEnd = current;
      continue;
    }

    ranges.push(formatDayRange(REMINDER_DAY_DEFINITIONS[rangeStart].key, REMINDER_DAY_DEFINITIONS[rangeEnd].key));
    rangeStart = current;
    rangeEnd = current;
  }

  ranges.push(formatDayRange(REMINDER_DAY_DEFINITIONS[rangeStart].key, REMINDER_DAY_DEFINITIONS[rangeEnd].key));

  return ranges.join(", ");
}

export function formatReminderSlots(reminderSlots: ReminderSlotKey[]) {
  if (!reminderSlots.length) {
    return "None selected";
  }

  return reminderSlots
    .map((slot) => {
      const definition = REMINDER_SLOT_DEFINITIONS.find((entry) => entry.key === slot);
      return definition ? `${definition.label} (${definition.scheduleLabel})` : slot;
    })
    .join(", ");
}

export function buildReminderStatusMessage(settings: ReminderSettings) {
  const headline = settings.remindersEnabled ? "Your reminders are on." : "Your reminders are off.";
  const daysText = formatReminderDays(settings.reminderDays);
  const slotsText = formatReminderSlots(settings.reminderSlots);
  const summaryText = `${headline} Days: ${daysText}. Reminders: ${slotsText}.`;

  const blocks: (KnownBlock | Block)[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${headline}*\n*Days:* ${daysText}\n*Reminders:* ${slotsText}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: settings.remindersEnabled
            ? "Times follow your current Slack timezone."
            : "Your saved schedule stays ready for when you turn reminders back on.",
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: REMINDERS_CONFIGURE_ACTION_ID,
          text: {
            type: "plain_text",
            text: "Configure",
          },
          value: "configure",
        },
        {
          type: "button",
          action_id: REMINDERS_TOGGLE_ACTION_ID,
          text: {
            type: "plain_text",
            text: settings.remindersEnabled ? "Turn off" : "Turn on",
          },
          value: settings.remindersEnabled ? "off" : "on",
          ...(settings.remindersEnabled ? { style: "danger" as const } : { style: "primary" as const }),
        },
      ],
    },
  ];

  return {
    text: summaryText,
    blocks,
  };
}

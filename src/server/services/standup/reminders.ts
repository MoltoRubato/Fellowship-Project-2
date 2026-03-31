import { db } from "@/server/db";
import {
  normalizeReminderDayKeys,
  normalizeReminderSlotKeys,
  type ReminderDayKey,
  type ReminderSlotKey,
} from "@/lib/reminders";
import { ensureSlackUser } from "./users";

export type ReminderSettings = {
  remindersEnabled: boolean;
  reminderDays: ReminderDayKey[];
  reminderSlots: ReminderSlotKey[];
};

const REMINDER_SETTINGS_SELECT = {
  remindersEnabled: true,
  reminderDays: true,
  reminderSlots: true,
} as const;

function toReminderSettings(input: {
  remindersEnabled: boolean;
  reminderDays: string[];
  reminderSlots: string[];
}): ReminderSettings {
  return {
    remindersEnabled: input.remindersEnabled,
    reminderDays: normalizeReminderDayKeys(input.reminderDays),
    reminderSlots: normalizeReminderSlotKeys(input.reminderSlots),
  };
}

export async function getReminderSettings(slackUserId: string, slackTeamId: string) {
  const { user } = await ensureSlackUser(slackUserId, slackTeamId);
  return toReminderSettings(user);
}

export async function setReminderPreference(input: {
  slackUserId: string;
  slackTeamId: string;
  remindersEnabled: boolean;
}) {
  const { user } = await ensureSlackUser(input.slackUserId, input.slackTeamId);

  if (user.remindersEnabled === input.remindersEnabled) {
    return toReminderSettings(user);
  }

  const updatedUser = await db.user.update({
    where: { id: user.id },
    data: { remindersEnabled: input.remindersEnabled },
    select: REMINDER_SETTINGS_SELECT,
  });

  return toReminderSettings(updatedUser);
}

export async function updateReminderSchedule(input: {
  slackUserId: string;
  slackTeamId: string;
  reminderDays: readonly string[];
  reminderSlots: readonly string[];
}) {
  const { user } = await ensureSlackUser(input.slackUserId, input.slackTeamId);
  const reminderDays = normalizeReminderDayKeys(input.reminderDays);
  const reminderSlots = normalizeReminderSlotKeys(input.reminderSlots);

  const updatedUser = await db.user.update({
    where: { id: user.id },
    data: {
      reminderDays,
      reminderSlots,
    },
    select: REMINDER_SETTINGS_SELECT,
  });

  return toReminderSettings(updatedUser);
}

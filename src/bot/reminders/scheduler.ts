import cron from "node-cron";
import type { App } from "@slack/bolt";
import { getSlackUserProfile } from "@/server/services/slack";
import { listActiveSlackUsers } from "@/server/services/standup";
import {
  getReminderDayForWeekday,
  normalizeReminderDayKeys,
  normalizeReminderSlotKeys,
} from "@/lib/reminders";
import { REMINDER_CHECK_SCHEDULE, REMINDERS, type ReminderDefinition } from "./config";
import { getLocalTimeSnapshot } from "./local-time";

const RECENT_REMINDER_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const SENT_REMINDER_KEYS = new Map<string, number>();

export function startReminderJobs(app: App) {
  cron.schedule(REMINDER_CHECK_SCHEDULE, async () => {
    await sendDueReminders(app, new Date());
  });
}

async function sendDueReminders(app: App, now: Date) {
  pruneSentReminderKeys(now.getTime());

  const users = await listActiveSlackUsers();

  for (const user of users) {
    await sendDueReminderForUser(app, user, now);
  }
}

async function sendDueReminderForUser(
  app: App,
  user: Awaited<ReturnType<typeof listActiveSlackUsers>>[number],
  now: Date,
) {
  if (!user.remindersEnabled) {
    return;
  }

  const slackUserId = user.slackUserId;
  let profile;

  try {
    profile = await getSlackUserProfile(slackUserId);
  } catch (error) {
    console.error("Skipping reminder: Slack profile lookup failed", slackUserId, error);
    return;
  }

  const timeZone = profile?.timeZone;

  if (!timeZone) {
    console.warn("Skipping reminder: Slack timezone unavailable", slackUserId);
    return;
  }

  let localTime;

  try {
    localTime = getLocalTimeSnapshot(now, timeZone);
  } catch (error) {
    console.error("Skipping reminder: could not resolve local time", slackUserId, timeZone, error);
    return;
  }

  const configuredDays = normalizeReminderDayKeys(user.reminderDays);
  const configuredSlots = new Set(normalizeReminderSlotKeys(user.reminderSlots));
  const localDayKey = getReminderDayForWeekday(localTime.weekday);

  if (!localDayKey || !configuredDays.includes(localDayKey)) {
    return;
  }

  const reminder = REMINDERS.find(
    (entry) =>
      configuredSlots.has(entry.key) &&
      isReminderDue(entry, localTime.hour, localTime.minute),
  );

  if (!reminder) {
    return;
  }

  const reminderKey = `${slackUserId}:${reminder.key}:${localTime.dateKey}`;

  if (SENT_REMINDER_KEYS.has(reminderKey)) {
    return;
  }

  SENT_REMINDER_KEYS.set(reminderKey, now.getTime());

  try {
    await app.client.chat.postMessage({
      channel: slackUserId,
      text: reminder.text,
    });
  } catch (error) {
    SENT_REMINDER_KEYS.delete(reminderKey);
    console.error("Reminder failed", slackUserId, reminder.key, timeZone, error);
  }
}

function isReminderDue(reminder: ReminderDefinition, hour: number, minute: number) {
  return reminder.hour === hour && reminder.minute === minute;
}

function pruneSentReminderKeys(nowMs: number) {
  for (const [key, sentAtMs] of SENT_REMINDER_KEYS) {
    if (nowMs - sentAtMs > RECENT_REMINDER_TTL_MS) {
      SENT_REMINDER_KEYS.delete(key);
    }
  }
}

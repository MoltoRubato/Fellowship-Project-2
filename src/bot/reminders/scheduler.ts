import cron from "node-cron";
import { Prisma } from "@prisma/client";
import type { App } from "@slack/bolt";
import { db } from "@/server/db";
import { getSlackUserProfile } from "@/server/services/slack";
import type { SlackClient } from "@/server/services/slack-client";
import { listActiveSlackUsers } from "@/server/services/standup";
import {
  getReminderDayForWeekday,
  normalizeReminderDayKeys,
  normalizeReminderSlotKeys,
} from "@/lib/reminders";
import { REMINDER_CHECK_SCHEDULE, REMINDERS, type ReminderDefinition } from "./config";
import { getLocalTimeSnapshot } from "./local-time";

export function startReminderJobs(app: App) {
  cron.schedule(REMINDER_CHECK_SCHEDULE, async () => {
    await sendDueReminders(app.client as unknown as SlackClient, new Date());
  });
}

export async function sendDueReminders(client: SlackClient, now: Date) {
  const users = await listActiveSlackUsers();
  const failedUsers: string[] = [];
  let sent = 0;
  let alreadySent = 0;
  let dueUsers = 0;

  for (const user of users) {
    try {
      const outcome = await sendDueReminderForUser(client, user, now);

      if (outcome === "sent") {
        sent += 1;
        dueUsers += 1;
        continue;
      }

      if (outcome === "already_sent") {
        alreadySent += 1;
        dueUsers += 1;
      }
    } catch (error) {
      failedUsers.push(user.slackUserId);
      console.error("Reminder dispatch failed", user.slackUserId, error);
    }
  }

  return {
    ranAt: now.toISOString(),
    usersSeen: users.length,
    dueUsers,
    sent,
    alreadySent,
    failedUsers,
  };
}

async function sendDueReminderForUser(
  client: SlackClient,
  user: Awaited<ReturnType<typeof listActiveSlackUsers>>[number],
  now: Date,
) {
  if (!user.remindersEnabled) {
    return "disabled" as const;
  }

  const slackUserId = user.slackUserId;
  let profile;

  try {
    profile = await getSlackUserProfile(slackUserId);
  } catch (error) {
    console.error("Skipping reminder: Slack profile lookup failed", slackUserId, error);
    return "no_timezone" as const;
  }

  const timeZone = profile?.timeZone;

  if (!timeZone) {
    console.warn("Skipping reminder: Slack timezone unavailable", slackUserId);
    return "no_timezone" as const;
  }

  let localTime;

  try {
    localTime = getLocalTimeSnapshot(now, timeZone);
  } catch (error) {
    console.error("Skipping reminder: could not resolve local time", slackUserId, timeZone, error);
    return "no_timezone" as const;
  }

  const configuredDays = normalizeReminderDayKeys(user.reminderDays);
  const configuredSlots = new Set(normalizeReminderSlotKeys(user.reminderSlots));
  const localDayKey = getReminderDayForWeekday(localTime.weekday);

  if (!localDayKey || !configuredDays.includes(localDayKey)) {
    return "not_due" as const;
  }

  const reminder = REMINDERS.find(
    (entry) =>
      configuredSlots.has(entry.key) &&
      isReminderDue(entry, localTime.hour, localTime.minute),
  );

  if (!reminder) {
    return "not_due" as const;
  }

  try {
    await db.reminderDelivery.create({
      data: {
        userId: user.id,
        reminderKey: reminder.key,
        reminderDateKey: localTime.dateKey,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return "already_sent" as const;
    }

    throw error;
  }

  try {
    await client.chat.postMessage({
      channel: slackUserId,
      text: reminder.text,
    });
    return "sent" as const;
  } catch (error) {
    await db.reminderDelivery.deleteMany({
      where: {
        userId: user.id,
        reminderKey: reminder.key,
        reminderDateKey: localTime.dateKey,
      },
    });
    console.error("Reminder failed", slackUserId, reminder.key, timeZone, error);
    throw error;
  }
}

function isReminderDue(reminder: ReminderDefinition, hour: number, minute: number) {
  return reminder.hour === hour && reminder.minute === minute;
}

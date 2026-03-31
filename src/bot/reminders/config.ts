export const REMINDER_CHECK_SCHEDULE = "* * * * *";

export const REMINDERS = [
  {
    key: "morning",
    hour: 9,
    minute: 0,
    text: "Morning check-in: what are you working on today? Use `/did` to log your first update.",
  },
  {
    key: "evening",
    hour: 17,
    minute: 0,
    text: "End-of-day nudge: run `/summarise` when you're ready to paste your standup update.",
  },
] as const;

export type ReminderDefinition = (typeof REMINDERS)[number];

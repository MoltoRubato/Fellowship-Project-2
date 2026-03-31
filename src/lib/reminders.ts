export const REMINDER_DAY_DEFINITIONS = [
  { key: "mon", shortLabel: "Mon", longLabel: "Monday", weekday: 1 },
  { key: "tue", shortLabel: "Tue", longLabel: "Tuesday", weekday: 2 },
  { key: "wed", shortLabel: "Wed", longLabel: "Wednesday", weekday: 3 },
  { key: "thu", shortLabel: "Thu", longLabel: "Thursday", weekday: 4 },
  { key: "fri", shortLabel: "Fri", longLabel: "Friday", weekday: 5 },
  { key: "sat", shortLabel: "Sat", longLabel: "Saturday", weekday: 6 },
  { key: "sun", shortLabel: "Sun", longLabel: "Sunday", weekday: 0 },
] as const;

export const REMINDER_SLOT_DEFINITIONS = [
  {
    key: "morning",
    label: "Morning",
    scheduleLabel: "9am",
    hour: 9,
    minute: 0,
    text: "Morning check-in: what are you working on today? Use `/did` to log your first update.",
  },
  {
    key: "evening",
    label: "End of day",
    scheduleLabel: "5pm",
    hour: 17,
    minute: 0,
    text: "End-of-day nudge: run `/summarise` when you're ready to paste your standup update.",
  },
] as const;

export type ReminderDayKey = (typeof REMINDER_DAY_DEFINITIONS)[number]["key"];
export type ReminderSlotKey = (typeof REMINDER_SLOT_DEFINITIONS)[number]["key"];
export type ReminderSlotDefinition = (typeof REMINDER_SLOT_DEFINITIONS)[number];

export const DEFAULT_REMINDER_DAYS: ReminderDayKey[] = ["mon", "tue", "wed", "thu", "fri"];
export const DEFAULT_REMINDER_SLOTS: ReminderSlotKey[] = ["morning", "evening"];
export const REMINDER_DAY_KEYS: ReminderDayKey[] = REMINDER_DAY_DEFINITIONS.map((day) => day.key);
export const REMINDER_SLOT_KEYS: ReminderSlotKey[] = REMINDER_SLOT_DEFINITIONS.map((slot) => slot.key);

const REMINDER_DAY_SET = new Set<string>(REMINDER_DAY_KEYS);
const REMINDER_SLOT_SET = new Set<string>(REMINDER_SLOT_KEYS);

export function isReminderDayKey(value: string): value is ReminderDayKey {
  return REMINDER_DAY_SET.has(value);
}

export function isReminderSlotKey(value: string): value is ReminderSlotKey {
  return REMINDER_SLOT_SET.has(value);
}

export function normalizeReminderDayKeys(input?: readonly string[] | null) {
  const selected = new Set(input ?? DEFAULT_REMINDER_DAYS);
  return REMINDER_DAY_KEYS.filter((day) => selected.has(day));
}

export function normalizeReminderSlotKeys(input?: readonly string[] | null) {
  const selected = new Set(input ?? DEFAULT_REMINDER_SLOTS);
  return REMINDER_SLOT_KEYS.filter((slot) => selected.has(slot));
}

export function getReminderDayForWeekday(weekday: number) {
  return REMINDER_DAY_DEFINITIONS.find((day) => day.weekday === weekday)?.key ?? null;
}

export function getReminderSlotDefinition(slotKey: ReminderSlotKey) {
  const slot = REMINDER_SLOT_DEFINITIONS.find((entry) => entry.key === slotKey);

  if (!slot) {
    throw new Error(`Unknown reminder slot: ${slotKey}`);
  }

  return slot;
}

export function getReminderDayDefinition(dayKey: ReminderDayKey) {
  const day = REMINDER_DAY_DEFINITIONS.find((entry) => entry.key === dayKey);

  if (!day) {
    throw new Error(`Unknown reminder day: ${dayKey}`);
  }

  return day;
}

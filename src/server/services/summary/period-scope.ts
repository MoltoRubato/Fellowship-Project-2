import type { SummaryPeriod } from "./types";
import { getSlackLocalTimeSnapshot } from "@/server/services/slack";

function shiftDateKey(dateKey: string, deltaDays: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }

  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

export async function getSummaryPeriodDateScope(
  slackUserId: string,
  period: SummaryPeriod,
  date = new Date(),
) {
  const snapshot = await getSlackLocalTimeSnapshot(slackUserId, date);
  const weekStartOffset = snapshot.weekday === 0 ? -6 : 1 - snapshot.weekday;

  return {
    todayDateKey: snapshot.dateKey,
    startDateKey: period === "week" ? shiftDateKey(snapshot.dateKey, weekStartOffset) : snapshot.dateKey,
  };
}

export function getSummarySyncSince(period: SummaryPeriod, date = new Date()) {
  const lookbackHours = period === "week" ? 24 * 8 : 24 * 2;
  return new Date(date.getTime() - lookbackHours * 60 * 60 * 1000);
}

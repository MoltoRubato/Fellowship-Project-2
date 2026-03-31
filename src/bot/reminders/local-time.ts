const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type LocalTimeSnapshot = {
  dateKey: string;
  weekday: number;
  hour: number;
  minute: number;
};

export function getLocalTimeSnapshot(date: Date, timeZone: string): LocalTimeSnapshot {
  const formattedParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const getPartValue = (type: Intl.DateTimeFormatPartTypes) =>
    formattedParts.find((part) => part.type === type)?.value;

  const year = getPartValue("year");
  const month = getPartValue("month");
  const day = getPartValue("day");
  const weekdayKey = getPartValue("weekday");
  const hour = getPartValue("hour");
  const minute = getPartValue("minute");
  const weekday = weekdayKey ? WEEKDAY_INDEX[weekdayKey] : undefined;

  if (!year || !month || !day || !hour || !minute || !weekdayKey || weekday === undefined) {
    throw new Error(`Could not resolve local time snapshot for timezone ${timeZone}`);
  }

  return {
    dateKey: `${year}-${month}-${day}`,
    weekday,
    hour: Number(hour),
    minute: Number(minute),
  };
}

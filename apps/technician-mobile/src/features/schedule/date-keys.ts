const MELBOURNE_TIME_ZONE = "Australia/Melbourne";
const DATE_KEY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: MELBOURNE_TIME_ZONE,
  year: "numeric",
});
const DISPLAY_DATE_FORMATTER = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "long",
  timeZone: MELBOURNE_TIME_ZONE,
  weekday: "long",
});

export function todayDateKey(now = new Date()): string {
  const parts = DATE_KEY_FORMATTER.formatToParts(now);
  const year = partValue(parts, "year");
  const month = partValue(parts, "month");
  const day = partValue(parts, "day");
  return `${year}-${month}-${day}`;
}

export function shiftDateKey(dateKey: string, days: number): string {
  const { day, month, year } = parseDateKey(dateKey);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12));

  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function relativeDateTitle(dateKey: string, now = new Date()): string {
  const today = todayDateKey(now);
  if (dateKey === today) {
    return "Today";
  }
  if (dateKey === shiftDateKey(today, -1)) {
    return "Yesterday";
  }
  if (dateKey === shiftDateKey(today, 1)) {
    return "Tomorrow";
  }
  return "Schedule";
}

export function displayDateLabel(dateKey: string): string {
  const { day, month, year } = parseDateKey(dateKey);
  const parts = DISPLAY_DATE_FORMATTER.formatToParts(
    new Date(Date.UTC(year, month - 1, day, 12)),
  );
  return `${partValue(parts, "weekday")}, ${partValue(parts, "day")} ${partValue(parts, "month")}`;
}

function partValue(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const part = parts.find((candidate) => candidate.type === type);
  if (!part) {
    throw new Error(`Could not resolve date part ${type}.`);
  }
  return part.value;
}

function parseDateKey(dateKey: string) {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/.exec(dateKey);
  if (!match?.groups) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }

  return {
    day: Number(match.groups.day),
    month: Number(match.groups.month),
    year: Number(match.groups.year),
  };
}

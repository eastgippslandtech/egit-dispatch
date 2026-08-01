import {
  addDaysToDateKey,
  todayDateKey,
} from "@/server/dispatch/date-scope";

const OFFICE_CLOSE_MINUTES = 17 * 60;

export function getWallboardDateAfterRefresh({
  lastAutoAdvancedDateKey,
  now,
  selectedDateKey,
}: {
  lastAutoAdvancedDateKey?: string;
  now: Date;
  selectedDateKey: string;
}) {
  const currentDateKey = todayDateKey(now);
  const refreshedSelectedDateKey =
    selectedDateKey < currentDateKey ? currentDateKey : selectedDateKey;
  if (
    refreshedSelectedDateKey !== currentDateKey ||
    lastAutoAdvancedDateKey === currentDateKey ||
    melbourneMinutesSinceMidnight(now) < OFFICE_CLOSE_MINUTES
  ) {
    return {
      autoAdvancedFromDateKey: undefined,
      selectedDateKey: refreshedSelectedDateKey,
    };
  }

  return {
    autoAdvancedFromDateKey: currentDateKey,
    selectedDateKey: nextWorkingDateKey(currentDateKey),
  };
}

function melbourneMinutesSinceMidnight(now: Date) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: "Australia/Melbourne",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour * 60 + minute;
}

function nextWorkingDateKey(dateKey: string) {
  let nextDateKey = addDaysToDateKey(dateKey, 1);
  while (isWeekend(nextDateKey)) {
    nextDateKey = addDaysToDateKey(nextDateKey, 1);
  }
  return nextDateKey;
}

function isWeekend(dateKey: string) {
  const weekday = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

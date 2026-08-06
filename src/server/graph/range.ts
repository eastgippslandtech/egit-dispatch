import { addDaysToDateKey, getWeekRange } from "@/server/dispatch/date-scope";
import type { GraphCalendarRange } from "./types";

export function buildGraphDayRange(dateKey: string): GraphCalendarRange {
  return {
    startDateTime: `${dateKey}T00:00:00`,
    endDateTime: `${addDaysToDateKey(dateKey, 1)}T00:00:00`,
  };
}

export function buildGraphWorkWeekRange(dateKey: string): GraphCalendarRange {
  const weekDays = getWeekRange(dateKey);
  const monday = weekDays[0]?.dateKey ?? dateKey;
  const friday = weekDays[4]?.dateKey ?? dateKey;

  return {
    startDateTime: `${monday}T00:00:00`,
    endDateTime: `${addDaysToDateKey(friday, 1)}T00:00:00`,
  };
}

export function buildGraphPlanningRange(dateKey: string): GraphCalendarRange {
  const currentWeek = buildGraphWorkWeekRange(dateKey);
  const nextWeek = buildGraphWorkWeekRange(addDaysToDateKey(dateKey, 7));

  return {
    startDateTime: currentWeek.startDateTime,
    endDateTime: nextWeek.endDateTime,
  };
}

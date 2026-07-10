import {
  getTimelineItemPosition,
  getTimelinePosition,
  timeFromMinutes,
} from "./scheduling";

import { todayDateKey } from "./date-scope";

export type CurrentTimeIndicator = {
  elapsedWidthPx: number;
  elapsedWidthPercent: number;
  label: string;
  positionPx: number;
  positionPercent: number;
  visible: boolean;
};

export function getCurrentTimeIndicator(
  selectedDateKey: string,
  now = new Date(),
): CurrentTimeIndicator {
  if (!isTodayInDispatchTimezone(selectedDateKey, now)) {
    return {
      elapsedWidthPx: 0,
      elapsedWidthPercent: 0,
      label: "",
      positionPx: 0,
      positionPercent: 0,
      visible: false,
    };
  }

  const currentTime = timeFromMinutes(currentMelbourneMinutes(now));
  const pixelPosition = getTimelineItemPosition({
    itemEnd: currentTime,
    itemStart: currentTime,
  });
  const position = getTimelinePosition({
    itemEnd: currentTime,
    itemStart: currentTime,
  });

  return {
    elapsedWidthPx: pixelPosition.leftPx,
    elapsedWidthPercent: position.leftPercent,
    label: formatMelbourneTime(now),
    positionPx: pixelPosition.leftPx,
    positionPercent: position.leftPercent,
    visible: true,
  };
}

export function isTodayInDispatchTimezone(dateKey: string, now = new Date()) {
  return dateKey === todayDateKey(now);
}

export function getWeekTodayDateKey(
  weekDays: Array<{ dateKey: string }>,
  now = new Date(),
) {
  const currentDateKey = todayDateKey(now);

  return weekDays.some((day) => day.dateKey === currentDateKey)
    ? currentDateKey
    : undefined;
}

function currentMelbourneMinutes(now: Date) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: "Australia/Melbourne",
  }).formatToParts(now);
  const part = (type: string) =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);

  return part("hour") * 60 + part("minute");
}

function formatMelbourneTime(now: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Australia/Melbourne",
  })
    .format(now)
    .replace("am", "AM")
    .replace("pm", "PM");
}

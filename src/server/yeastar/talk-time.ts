import type {
  YeastarCallSegmentInput,
  YeastarReportableCallInput,
} from "./types";

const MELBOURNE_TIMEZONE = "Australia/Melbourne";

export function isReportableExternalCall(call: YeastarReportableCallInput) {
  const type = call.callType.trim().toLowerCase();
  return (
    call.answered &&
    call.connectedTalkSeconds > 0 &&
    call.hasExternalParty &&
    call.hasTrunk &&
    !["internal", "voicemail", "paging", "intercom", "system"].some(
      (excluded) => type.includes(excluded),
    )
  );
}

export function attributeExternalTalkSegments(
  segments: YeastarCallSegmentInput[],
) {
  const seen = new Set<string>();
  return segments.filter((segment) => {
    if (
      !segment.segmentId.trim() ||
      !segment.extension.trim() ||
      segment.talkSeconds <= 0 ||
      seen.has(segment.segmentId)
    ) {
      return false;
    }
    seen.add(segment.segmentId);
    return true;
  });
}

export function getMelbourneWeekRange(now = new Date()) {
  const local = localDateParts(now);
  const day = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(local.year, local.month - 1, local.day + mondayOffset));

  return {
    end: now.toISOString(),
    start: localMidnightToUtc(
      monday.getUTCFullYear(),
      monday.getUTCMonth() + 1,
      monday.getUTCDate(),
    ).toISOString(),
  };
}

export function formatTalkTime(seconds: number) {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
}

function localDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: MELBOURNE_TIMEZONE,
    year: "numeric",
  }).formatToParts(date);
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { day: read("day"), month: read("month"), year: read("year") };
}

function localMidnightToUtc(year: number, month: number, day: number) {
  const noonGuess = new Date(Date.UTC(year, month - 1, day, 12));
  const formatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: MELBOURNE_TIMEZONE,
    year: "numeric",
  });
  const parts = formatter.formatToParts(noonGuess);
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const representedAsUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  const offset = representedAsUtc - noonGuess.getTime();
  return new Date(Date.UTC(year, month - 1, day) - offset);
}

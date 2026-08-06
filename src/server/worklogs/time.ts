export const WORKLOG_ROUNDING_MINUTES = 15;

export function roundWorklogMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return Number.NaN;
  if (minutes <= 0) return 0;
  return Math.ceil(minutes / WORKLOG_ROUNDING_MINUTES) * WORKLOG_ROUNDING_MINUTES;
}

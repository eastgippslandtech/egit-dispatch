import type { BookingType, DispatchRequest } from "./types";

export const ONSITE_NOTE_TIME_MINUTES = 15;

export function bookingTypeForRequest(
  request: Pick<
    DispatchRequest,
    "bookingType" | "customer" | "onsite" | "site"
  >,
): BookingType {
  if (request.bookingType) {
    return request.bookingType;
  }

  const location = `${request.site} ${request.customer}`.toLowerCase();

  if (request.onsite === false || location.includes("remote")) {
    return "Remote";
  }

  if (/internal egit|workshop|in[- ]house/.test(location)) {
    return "In house";
  }

  return "Onsite";
}

export function bookingTiming(
  workDurationMinutes: number,
  bookingType: BookingType,
) {
  const noteTimeMinutes =
    bookingType === "Onsite" ? ONSITE_NOTE_TIME_MINUTES : 0;

  return {
    noteTimeMinutes,
    totalDurationMinutes: workDurationMinutes + noteTimeMinutes,
    workDurationMinutes,
  };
}

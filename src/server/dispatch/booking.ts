import type { BookingType, DispatchRequest } from "./types";

export const ONSITE_NOTE_TIME_MINUTES = 15;

export function applyBookingTypeToRequest<
  T extends Pick<
    DispatchRequest,
    "bookingType" | "mockTravelMinutes" | "onsite" | "siteTown"
  >,
>(request: T, bookingType: BookingType): T {
  const previousTown = request.siteTown?.trim().toLowerCase();

  return {
    ...request,
    bookingType,
    mockTravelMinutes:
      bookingType === "Onsite" && request.mockTravelMinutes === 0
        ? undefined
        : request.mockTravelMinutes,
    onsite: bookingType === "Onsite",
    siteTown:
      bookingType === "Remote"
        ? "Remote"
        : previousTown === "remote"
          ? undefined
          : request.siteTown,
  };
}

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

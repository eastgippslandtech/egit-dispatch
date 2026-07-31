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
  request: Pick<DispatchRequest, "bookingType" | "onsite"> &
    Partial<
      Pick<
    DispatchRequest,
        | "category"
        | "customer"
        | "item"
        | "notes"
        | "site"
        | "siteAddress"
        | "siteArea"
        | "siteName"
        | "siteTown"
        | "subcategory"
        | "subject"
      >
    >,
): BookingType {
  if (request.bookingType) {
    return request.bookingType;
  }

  if (request.onsite === false) {
    return "Remote";
  }

  if (request.onsite === true) {
    return "Onsite";
  }

  const context = [
    request.subject,
    request.notes,
    request.category,
    request.subcategory,
    request.item,
    request.customer,
    request.site,
    request.siteName,
    request.siteAddress,
    request.siteTown,
    request.siteArea,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(remote|remotely|teams|screenconnect|phone support|telephone support)\b/.test(context)) {
    return "Remote";
  }

  if (/internal egit|egit workshop|\bin[- ]house\b/.test(context)) {
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

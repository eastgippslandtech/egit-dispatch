import type { Appointment, BookingType } from "./types";
import { minutesFromTime } from "./scheduling";
import { roundWorklogMinutes } from "@/server/worklogs/time";

export type ChargeableTimeBreakdown = {
  jobMinutes: number;
  totalMinutes: number;
  travelMinutes: number;
};

export function getChargeableTicketTime({
  appointment,
  bookingType,
}: {
  appointment?: Appointment;
  bookingType?: BookingType;
}): ChargeableTimeBreakdown {
  if (!appointment) {
    return { jobMinutes: 0, totalMinutes: 0, travelMinutes: 0 };
  }

  const jobMinutes = Math.max(
    0,
    minutesFromTime(appointment.end) - minutesFromTime(appointment.start),
  );
  const travelMinutes =
    bookingType === "Onsite"
      ? Math.max(
          0,
          (appointment.travelToSiteMinutes ?? 0) +
            (appointment.travelBackToOfficeMinutes ?? 0),
        )
      : 0;

  return {
    jobMinutes,
    totalMinutes: roundWorklogMinutes(jobMinutes + travelMinutes),
    travelMinutes,
  };
}

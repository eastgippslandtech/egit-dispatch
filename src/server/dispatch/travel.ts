import type { ScheduleWarning } from "./scheduling";
import type {
  Appointment,
  DispatchRequest,
  Technician,
  TravelCalculatedFrom,
  TravelMode,
} from "./types";

const WORKDAY_START_MINUTES = 9 * 60;
const WORKDAY_END_MINUTES = 17 * 60;

export type OfficeLocation = {
  address: string;
  id: "bairnsdale" | "sale";
  name: string;
};

export type TravelSite = Pick<
  DispatchRequest,
  "siteAddress" | "siteTown" | "siteArea" | "onsite" | "mockTravelMinutes"
>;

export type TravelEstimate = {
  officeOriginAddress: string;
  officeOriginId: OfficeLocation["id"];
  officeOriginName: string;
  travelCalculatedFrom: TravelCalculatedFrom;
  travelBackToOfficeMinutes: number;
  travelCalculationReason: string;
  travelEstimated: boolean;
  travelMode: TravelMode;
  travelToSiteMinutes: number;
  travelWarning?: string;
};

export const EGIT_OFFICES: Record<OfficeLocation["id"], OfficeLocation> = {
  bairnsdale: {
    id: "bairnsdale",
    name: "Bairnsdale",
    address: "137 Main Street, Bairnsdale VIC 3875",
  },
  sale: {
    id: "sale",
    name: "Sale",
    address: "387 Raymond Street, Sale VIC 3850",
  },
};

const MOCK_TRAVEL_LOOKUP: Record<OfficeLocation["id"], Record<string, number>> = {
  bairnsdale: {
    bairnsdale: 10,
    "lakes entrance": 35,
    paynesville: 20,
    sale: 70,
  },
  sale: {
    bairnsdale: 70,
    maffra: 25,
    sale: 10,
  },
};

export function roundTravelMinutes(minutes: number) {
  if (minutes <= 0) {
    return 0;
  }

  return Math.ceil(minutes / 5) * 5;
}

export function getOfficeForTechnician(technician: Technician): OfficeLocation {
  if (technician.baseOfficeId === "sale") {
    return EGIT_OFFICES.sale;
  }

  return EGIT_OFFICES.bairnsdale;
}

export const getTechnicianBaseOffice = getOfficeForTechnician;

export function estimateOfficeToSiteTravel(
  office: OfficeLocation,
  site: TravelSite,
): TravelEstimate {
  if (site.onsite === false || site.siteTown?.toLowerCase() === "remote") {
    return buildEstimate(office, 0, false, undefined, "Remote job: no travel buffer");
  }

  if (typeof site.mockTravelMinutes === "number") {
    return buildEstimate(office, site.mockTravelMinutes, false);
  }

  const town = site.siteTown?.trim().toLowerCase();
  const lookup = town ? MOCK_TRAVEL_LOOKUP[office.id][town] : undefined;

  if (typeof lookup === "number") {
    return buildEstimate(office, lookup, false);
  }

  return buildEstimate(
    office,
    15,
    true,
    site.siteAddress ? "estimated travel" : "missing site address",
  );
}

export function buildAppointmentTravel({
  request,
  technician,
}: {
  request?: DispatchRequest;
  technician?: Technician;
}): TravelEstimate | undefined {
  if (!request || !technician) {
    return undefined;
  }

  return estimateOfficeToSiteTravel(getOfficeForTechnician(technician), request);
}

export function getAppointmentTravelContext(appointment: Appointment) {
  return {
    siteArea: appointment.siteArea,
    travelCalculatedFrom:
      appointment.travelCalculatedFrom ?? "technician_base_office",
    travelCalculationReason:
      appointment.travelCalculationReason ??
      "Estimated from technician base office",
    travelEstimated: appointment.travelEstimated ?? false,
    travelMode: appointment.travelMode ?? "office_to_site_and_back",
  };
}

export function applyTravelToAppointment(
  appointment: Appointment,
  travel?: TravelEstimate,
) {
  if (!travel) {
    return appointment;
  }

  return {
    ...appointment,
    officeOriginAddress: travel.officeOriginAddress,
    officeOriginId: travel.officeOriginId,
    officeOriginName: travel.officeOriginName,
    travelBackToOfficeMinutes: travel.travelBackToOfficeMinutes,
    travelCalculatedFrom: travel.travelCalculatedFrom,
    travelCalculationReason: travel.travelCalculationReason,
    travelEstimated: travel.travelEstimated,
    travelMode: travel.travelMode,
    travelToSiteMinutes: travel.travelToSiteMinutes,
    travelWarning: travel.travelWarning,
  };
}

export function getAppointmentBlockedWindow(appointment: Appointment) {
  const jobStart = appointment.start;
  const jobEnd = appointment.end;
  const blockedStart = timeFromMinutes(
    minutesFromTime(jobStart) - (appointment.travelToSiteMinutes ?? 0),
  );
  const blockedEnd = timeFromMinutes(
    minutesFromTime(jobEnd) + (appointment.travelBackToOfficeMinutes ?? 0),
  );

  return {
    blockedEnd,
    blockedStart,
    jobEnd,
    jobStart,
  };
}

export const getBlockedWindow = getAppointmentBlockedWindow;

export function detectTravelScheduleWarnings({
  appointment,
  appointments,
}: {
  appointment: Appointment;
  appointments: Appointment[];
}) {
  const warnings: ScheduleWarning[] = [];
  const candidate = appointmentWithWindow(appointment);

  if (candidate.blockedStartMinutes < WORKDAY_START_MINUTES) {
    warnings.push({
      code: "travel-conflict",
      message: "Travel starts before working hours.",
    });
  }

  if (candidate.blockedEndMinutes > WORKDAY_END_MINUTES) {
    warnings.push({
      code: "travel-conflict",
      message: "Return travel ends after working hours.",
    });
  }

  if (appointment.travelWarning) {
    warnings.push({
      code: "travel-conflict",
      message: appointment.travelWarning,
    });
  }

  for (const otherAppointment of appointments) {
    if (otherAppointment.id === appointment.id) {
      continue;
    }

    if (otherAppointment.technicianId !== appointment.technicianId) {
      continue;
    }

    if (
      appointment.date &&
      otherAppointment.date &&
      otherAppointment.date !== appointment.date
    ) {
      continue;
    }

    const other = appointmentWithWindow(otherAppointment);

    if (
      overlaps(
        candidate.jobStartMinutes,
        candidate.jobEndMinutes,
        other.jobStartMinutes,
        other.jobEndMinutes,
      )
    ) {
      warnings.push({
        code: "overlap",
        message: "Job overlaps another appointment.",
      });
      continue;
    }

    if (
      overlaps(
        candidate.blockedStartMinutes,
        candidate.jobStartMinutes,
        other.blockedStartMinutes,
        other.blockedEndMinutes,
      )
    ) {
      warnings.push({
        code: "travel-conflict",
        message: "Travel to site overlaps the previous booking.",
      });
    }

    if (
      overlaps(
        candidate.jobEndMinutes,
        candidate.blockedEndMinutes,
        other.blockedStartMinutes,
        other.blockedEndMinutes,
      )
    ) {
      warnings.push({
        code: "travel-conflict",
        message: "Return travel overlaps the next booking.",
      });
    }
  }

  return dedupeWarnings(warnings);
}

export function countTravelConflicts(appointments: Appointment[]) {
  return appointments.filter((appointment) =>
    detectTravelScheduleWarnings({ appointment, appointments }).some(
      (warning) => warning.code === "travel-conflict",
    ),
  ).length;
}

function buildEstimate(
  office: OfficeLocation,
  rawMinutes: number,
  travelEstimated: boolean,
  travelWarning?: string,
  travelCalculationReason = "Estimated from technician base office",
): TravelEstimate {
  const rounded = roundTravelMinutes(rawMinutes);

  // TODO: Future smarter travel modes should live beside this V1 office-based
  // estimate, not inside React. Later, if a technician has a previous
  // appointment in the same town/area, travel can be calculated from that
  // previous job instead of the base office.
  // TODO: If previous job siteArea equals next job siteArea, travelToSiteMinutes
  // can become 0 or a small configurable local buffer, and return-to-office
  // travel may only apply after the final job in that area.
  // TODO: Dispatch Health should eventually warn when unnecessary office-return
  // buffers create false conflicts. Live maps can replace this mock lookup when
  // route optimisation is deliberately added.
  return {
    officeOriginAddress: office.address,
    officeOriginId: office.id,
    officeOriginName: office.name,
    travelBackToOfficeMinutes: rounded,
    travelCalculatedFrom: "technician_base_office",
    travelCalculationReason,
    travelEstimated,
    travelMode: "office_to_site_and_back",
    travelToSiteMinutes: rounded,
    travelWarning,
  };
}

function appointmentWithWindow(appointment: Appointment) {
  const window = getAppointmentBlockedWindow(appointment);

  return {
    blockedEndMinutes: minutesFromTime(window.blockedEnd),
    blockedStartMinutes: minutesFromTime(window.blockedStart),
    jobEndMinutes: minutesFromTime(window.jobEnd),
    jobStartMinutes: minutesFromTime(window.jobStart),
  };
}

function minutesFromTime(time: string) {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function timeFromMinutes(totalMinutes: number) {
  const normalized = Math.max(0, Math.min(24 * 60 - 1, totalMinutes));
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function overlaps(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
) {
  return firstStart < secondEnd && secondStart < firstEnd;
}

function dedupeWarnings(warnings: ScheduleWarning[]) {
  const seen = new Set<string>();

  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.message}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

import { addDaysToDateKey } from "@/server/dispatch/date-scope";
import { readDispatchConfig } from "@/server/dispatch/env";
import type { Appointment, Technician } from "@/server/dispatch/types";
import { createGraphClient } from "@/server/graph/client";
import { mapGraphEventToAppointment } from "@/server/graph/mappers";

import type { DatabaseStaffRow } from "./database";

export interface MobileOutlookCalendar {
  findAppointment(input: {
    jobId: string;
    staff: DatabaseStaffRow;
  }): Promise<Appointment | null>;
  listAppointments(input: {
    from: string;
    staff: DatabaseStaffRow;
    to: string;
  }): Promise<Appointment[]>;
}

let configuredCalendar: MobileOutlookCalendar | undefined;

export function getConfiguredMobileOutlookCalendar(): MobileOutlookCalendar | null {
  const config = readDispatchConfig();
  if (
    config.calendarDataSource !== "outlook" ||
    !config.microsoft.clientId ||
    !config.microsoft.clientSecret ||
    !config.microsoft.tenantId
  ) {
    return null;
  }

  configuredCalendar ??= createMobileOutlookCalendar({
    clientId: config.microsoft.clientId,
    clientSecret: config.microsoft.clientSecret,
    tenantId: config.microsoft.tenantId,
    timezone: config.microsoft.timezone,
  });
  return configuredCalendar;
}

export function createMobileOutlookCalendar({
  clientId,
  clientSecret,
  tenantId,
  timezone,
}: {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  timezone: string;
}): MobileOutlookCalendar {
  const client = createGraphClient({
    clientId,
    clientSecret,
    tenantId,
    timezone,
  });

  return {
    async findAppointment({ jobId, staff }) {
      const technician = databaseStaffToTechnician(staff);
      const prefix = `outlook-${technician.id}-`;
      if (!jobId.startsWith(prefix)) {
        return null;
      }

      const eventId = jobId.slice(prefix.length);
      if (!eventId) {
        return null;
      }

      const event = await client.getEvent({
        eventId,
        userPrincipalName: staff.outlookUserPrincipalName || staff.outlookEmail,
      });
      return mapGraphEventToAppointment(event, technician);
    },

    async listAppointments({ from, staff, to }) {
      const technician = databaseStaffToTechnician(staff);
      const events = await client.listCalendarView({
        endDateTime: `${addDaysToDateKey(to, 1)}T00:00:00`,
        startDateTime: `${from}T00:00:00`,
        userPrincipalName: staff.outlookUserPrincipalName || staff.outlookEmail,
      });

      return events.map((event) =>
        mapGraphEventToAppointment(event, technician),
      );
    },
  };
}

function databaseStaffToTechnician(staff: DatabaseStaffRow): Technician {
  const baseOfficeId = staff.baseOffice === "Sale" ? "sale" : "bairnsdale";

  return {
    active: staff.active,
    baseOfficeAddress:
      baseOfficeId === "sale"
        ? "387 Raymond Street, Sale VIC 3850"
        : "137 Main Street, Bairnsdale VIC 3875",
    baseOfficeId,
    baseOfficeName: baseOfficeId === "sale" ? "Sale" : "Bairnsdale",
    calendarEnabled: true,
    displayName: staff.displayName,
    id: `tech-${staff.displayName.trim().toLowerCase()}`,
    mappingStatus: "mapped",
    mspCentralEmail: staff.mspCentralEmail,
    mspCentralTechnicianId: staff.mspCentralTechnicianId,
    outlookEmail: staff.outlookEmail,
    outlookUserPrincipalName: staff.outlookUserPrincipalName,
    role: staff.role === "admin" ? "admin" : "technician",
    storeLocation: baseOfficeId === "sale" ? "Sale" : "Bairnsdale",
    zohoEmail: staff.zohoEmail,
  };
}

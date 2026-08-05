import type { DispatchConfig } from "@/server/dispatch/env";
import { buildDispatchHealthItems } from "@/server/dispatch/health";
import type {
  Appointment,
  DispatchDashboardData,
  Technician,
} from "@/server/dispatch/types";
import { createGraphClient, GraphApiError } from "./client";
import { mapGraphEventToAppointment } from "./mappers";
import type { GraphCalendarRange } from "./types";

type OutlookCalendarDataInput = {
  config: DispatchConfig;
  mockData: DispatchDashboardData;
  range: GraphCalendarRange;
};

export async function buildOutlookCalendarDashboardData({
  config,
  mockData,
  range,
}: OutlookCalendarDataInput): Promise<DispatchDashboardData> {
  const enabledTechnicians = mockData.technicians.filter(
    (technician) => technician.active && technician.calendarEnabled !== false,
  );

  try {
    const appointments = (
      await readTechnicianCalendarAppointments({
        config,
        range,
        technicians: enabledTechnicians,
      })
    ).map((appointment) =>
      config.mode === "live" ? { ...appointment, readOnly: false } : appointment,
    );

    return {
      ...mockData,
      appointments,
      calendarDataSource: "outlook",
      calendarReadOnly: config.mode !== "live",
      calendarStatusLabel:
        config.mode === "live" ? "Outlook Read/Write" : "Outlook Read Only",
      healthItems: buildDispatchHealthItems({
        appointments,
        requests: mockData.requests,
        technicians: mockData.technicians,
      }),
    };
  } catch (error) {
    console.error("Outlook calendar read failed", safeGraphError(error));

    return {
      ...mockData,
      appointments: [],
      calendarDataSource: "outlook",
      calendarError:
        "Outlook calendar read failed. Mock mode is still available.",
      calendarReadOnly: config.mode !== "live",
      calendarStatusLabel:
        config.mode === "live" ? "Outlook Read/Write" : "Outlook Read Only",
      healthItems: buildDispatchHealthItems({
        appointments: [],
        requests: mockData.requests,
        technicians: mockData.technicians,
      }),
    };
  }
}

export async function readTechnicianCalendarAppointments({
  config,
  range,
  technicians,
}: {
  config: DispatchConfig;
  range: GraphCalendarRange;
  technicians: Technician[];
}): Promise<Appointment[]> {
  const client = createGraphClient({
    clientId: config.microsoft.clientId,
    clientSecret: config.microsoft.clientSecret,
    tenantId: config.microsoft.tenantId,
    timezone: config.microsoft.timezone,
  });
  const results = await Promise.allSettled(
    technicians.map(async (technician) => {
      const events = await client.listCalendarView({
        ...range,
        userPrincipalName:
          technician.outlookUserPrincipalName ?? technician.outlookEmail,
      });

      return events.map((event) =>
        mapGraphEventToAppointment(
          event,
          technician,
          config.mspCentral.requestWebBaseUrl,
        ),
      );
    }),
  );

  const appointments = results.flatMap((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    const technician = technicians[index];
    console.error("Outlook technician calendar read failed", {
      technician: technician?.displayName,
      userPrincipalName:
        technician?.outlookUserPrincipalName ?? technician?.outlookEmail,
      ...safeGraphError(result.reason),
    });
    return [];
  });

  if (
    appointments.length === 0 &&
    results.some((result) => result.status === "rejected")
  ) {
    throw results.find((result) => result.status === "rejected")?.reason;
  }

  return appointments.map(markClosedDayIssue);
}

export function safeGraphError(error: unknown) {
  if (error instanceof GraphApiError) {
    return {
      message: error.message,
      status: error.status,
    };
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: "Unknown Microsoft Graph error." };
}

function markClosedDayIssue(appointment: Appointment): Appointment {
  if (appointment.outlookIssue) {
    return appointment;
  }

  if (!appointment.date) {
    return appointment;
  }

  const weekday = new Date(`${appointment.date}T12:00:00+10:00`).getUTCDay();

  return weekday === 0 || weekday === 6
    ? { ...appointment, outlookIssue: "closed-day" }
    : appointment;
}

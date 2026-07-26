import type { DispatchDashboardData } from "@/server/dispatch/types";
import { todayDateKey } from "@/server/dispatch/date-scope";
import { getTestSyncedDispatchDashboardData } from "@/server/dispatch/test-sync-dashboard";

import { deriveTechnicianPresence } from "./derive";
import {
  getConfiguredPresenceOverrideRepository,
  type PresenceOverrideRepository,
} from "./repository";
import type { PresenceLeave, WallboardSnapshot } from "./types";
import {
  createZohoPeopleClient,
  readZohoPeopleConfig,
  type ZohoPeopleConfig,
} from "./zoho-people";

type PeopleClient = {
  listApprovedLeave(input: {
    fromDate: string;
    technicians: DispatchDashboardData["technicians"];
    toDate: string;
  }): Promise<PresenceLeave[]>;
};

export async function getWallboardSnapshot({
  getDashboard = getTestSyncedDispatchDashboardData,
  now = new Date(),
  peopleClient,
  peopleConfig = readZohoPeopleConfig(),
  repository = getConfiguredPresenceOverrideRepository(),
}: {
  getDashboard?: () => Promise<DispatchDashboardData>;
  now?: Date;
  peopleClient?: PeopleClient;
  peopleConfig?: ZohoPeopleConfig | null;
  repository?: Pick<PresenceOverrideRepository, "listActive"> | null;
} = {}): Promise<WallboardSnapshot> {
  const dashboard = sanitizeDashboard(await getDashboard());
  const sourceWarnings: string[] = [];
  const overrides = repository ? await repository.listActive(now) : [];
  let leaves: PresenceLeave[] = [];
  let peopleStatus: WallboardSnapshot["peopleStatus"] = "not_configured";

  if (peopleConfig) {
    try {
      const client =
        peopleClient ?? createZohoPeopleClient({ config: peopleConfig });
      const dateKey = todayDateKey(now);
      leaves = await client.listApprovedLeave({
        fromDate: dateKey,
        technicians: dashboard.technicians,
        toDate: dateKey,
      });
      peopleStatus = "connected";
    } catch (error) {
      peopleStatus = "unavailable";
      sourceWarnings.push("Zoho People leave is temporarily unavailable.");
      console.error("Zoho People leave read failed", safeError(error));
    }
  }

  return {
    dashboard,
    peopleStatus,
    presences: deriveTechnicianPresence({
      appointments: dashboard.appointments,
      leaves,
      now,
      overrides,
      requests: dashboard.requests,
      technicians: dashboard.technicians,
    }),
    sourceWarnings,
    updatedAt: now.toISOString(),
  };
}

function sanitizeDashboard(
  dashboard: DispatchDashboardData,
): DispatchDashboardData {
  return {
    ...dashboard,
    appointments: dashboard.appointments.map((appointment) => {
      if (!isPersonal(appointment)) {
        return appointment;
      }

      return {
        ...appointment,
        bodyPreview: undefined,
        customer: "Private",
        outlookAttendees: undefined,
        outlookOrganizer: undefined,
        siteAddress: undefined,
        siteArea: undefined,
        siteTown: undefined,
        title: "Personal",
      };
    }),
  };
}

function isPersonal(
  appointment: DispatchDashboardData["appointments"][number],
) {
  const sensitivity = appointment.outlookSensitivity?.toLowerCase();
  return (
    appointment.outlookIssue === "private" ||
    ["confidential", "personal", "private"].includes(sensitivity ?? "") ||
    appointment.outlookCategories?.some(
      (category) => category.trim().toLowerCase() === "personal",
    ) === true
  );
}

function safeError(error: unknown) {
  return error instanceof Error
    ? { message: error.message }
    : { message: "Unknown Zoho People error." };
}

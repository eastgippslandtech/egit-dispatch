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
import { getConfiguredYeastarRepository } from "@/server/yeastar/repository";

type PeopleClient = {
  listApprovedLeave(input: {
    fromDate: string;
    technicians: DispatchDashboardData["technicians"];
    toDate: string;
  }): Promise<PresenceLeave[]>;
};

export async function getWallboardSnapshot({
  auxiliaryTimeoutMs = 5_000,
  dashboardTimeoutMs = 25_000,
  getDashboard = getTestSyncedDispatchDashboardData,
  now = new Date(),
  peopleClient,
  peopleConfig = readZohoPeopleConfig(),
  repository = getConfiguredPresenceOverrideRepository(),
  talkTimeRepository = getConfiguredYeastarRepository(),
}: {
  auxiliaryTimeoutMs?: number;
  dashboardTimeoutMs?: number;
  getDashboard?: () => Promise<DispatchDashboardData>;
  now?: Date;
  peopleClient?: PeopleClient;
  peopleConfig?: ZohoPeopleConfig | null;
  repository?: Pick<PresenceOverrideRepository, "listActive"> | null;
  talkTimeRepository?: { getWeeklyTalkTotals(now?: Date): Promise<Record<string, number>> } | null;
} = {}): Promise<WallboardSnapshot> {
  const sourceWarnings: string[] = [];
  const [rawDashboard, overrides, weeklyExternalTalkSeconds] = await Promise.all([
    withTimeout(
      getDashboard(),
      dashboardTimeoutMs,
      "Command Centre dashboard read timed out.",
    ),
    repository
      ? withTimeout(
          repository.listActive(now),
          auxiliaryTimeoutMs,
          "Manual presence updates timed out.",
        ).catch((error) => {
          sourceWarnings.push(
            "Manual presence updates are temporarily unavailable.",
          );
          console.error("Presence override read failed", safeError(error));
          return [];
        })
      : Promise.resolve([]),
    talkTimeRepository
      ? withTimeout(
          talkTimeRepository.getWeeklyTalkTotals(now),
          auxiliaryTimeoutMs,
          "External talk-time read timed out.",
        ).catch((error) => {
          sourceWarnings.push(
            "External talk-time totals are temporarily unavailable.",
          );
          console.error("Yeastar talk-time read failed", safeError(error));
          return {};
        })
      : Promise.resolve({}),
  ]);
  const dashboard = sanitizeDashboard(rawDashboard);
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
    weeklyExternalTalkSeconds,
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

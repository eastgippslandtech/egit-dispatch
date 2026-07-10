import type { DispatchConfig } from "@/server/dispatch/env";
import { readDispatchConfig } from "@/server/dispatch/env";
import { getDispatchDesignMockData } from "@/server/dispatch/mock-data";
import { buildGraphDayRange } from "./range";
import { createGraphClient } from "./client";
import { safeGraphError } from "./technician-calendars";

export type GraphHealthStatus = {
  calendarReadsSucceeded: number;
  configuredTechnicians: number;
  env: {
    MICROSOFT_CLIENT_ID: boolean;
    MICROSOFT_CLIENT_SECRET: boolean;
    MICROSOFT_TENANT_ID: boolean;
  };
  errors: string[];
  ok: boolean;
  tokenAcquisitionSucceeded: boolean;
};

export async function getGraphHealthStatus(
  config: DispatchConfig = readDispatchConfig(),
): Promise<GraphHealthStatus> {
  const env = {
    MICROSOFT_CLIENT_ID: Boolean(config.microsoft.clientId),
    MICROSOFT_CLIENT_SECRET: Boolean(config.microsoft.clientSecret),
    MICROSOFT_TENANT_ID: Boolean(config.microsoft.tenantId),
  };
  const technicians = getDispatchDesignMockData().technicians.filter(
    (technician) => technician.active && technician.calendarEnabled !== false,
  );
  const status: GraphHealthStatus = {
    calendarReadsSucceeded: 0,
    configuredTechnicians: technicians.length,
    env,
    errors: [],
    ok: false,
    tokenAcquisitionSucceeded: false,
  };

  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET || !env.MICROSOFT_TENANT_ID) {
    status.errors.push("Microsoft Graph environment variables are incomplete.");
    return status;
  }

  const client = createGraphClient({
    clientId: config.microsoft.clientId,
    clientSecret: config.microsoft.clientSecret,
    tenantId: config.microsoft.tenantId,
    timezone: config.microsoft.timezone,
  });

  try {
    await client.acquireToken();
    status.tokenAcquisitionSucceeded = true;
  } catch (error) {
    status.errors.push(safeGraphError(error).message);
    return status;
  }

  const range = buildGraphDayRange(new Date().toISOString().slice(0, 10));

  for (const technician of technicians) {
    try {
      await client.listCalendarView({
        ...range,
        userPrincipalName:
          technician.outlookUserPrincipalName ?? technician.outlookEmail,
      });
      status.calendarReadsSucceeded += 1;
    } catch (error) {
      status.errors.push(
        `${technician.displayName}: ${safeGraphError(error).message}`,
      );
    }
  }

  status.ok =
    status.tokenAcquisitionSucceeded &&
    status.calendarReadsSucceeded === status.configuredTechnicians;

  return status;
}

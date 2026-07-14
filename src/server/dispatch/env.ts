type DispatchEnv = Record<string, string | undefined>;

export type DispatchRuntimeMode = "mock" | "live";
export type CalendarDataSource = "mock" | "outlook";
export type DispatchDataSource =
  | "mock"
  | "msp-central-fixture"
  | "msp-central"
  | "command-centre-db";

export type DispatchConfig = {
  calendarDataSource: CalendarDataSource;
  dispatchDataSource: DispatchDataSource;
  mode: DispatchRuntimeMode;
  timezone: string;
  appBaseUrl?: string;
  databaseUrl?: string;
  mspCentral: {
    baseUrl?: string;
    portal?: string;
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    requestWebBaseUrl?: string;
  };
  microsoft: {
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;
    timezone: string;
  };
};

const requiredLiveKeys = [
  "DATABASE_URL",
  "MSP_CENTRAL_BASE_URL",
  "MSP_CENTRAL_PORTAL",
  "MSP_CENTRAL_CLIENT_ID",
  "MSP_CENTRAL_CLIENT_SECRET",
  "MSP_CENTRAL_REFRESH_TOKEN",
  "MICROSOFT_TENANT_ID",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
] as const;

export function readDispatchConfig(env: DispatchEnv = process.env): DispatchConfig {
  const mode = env.MOCK_INTEGRATIONS === "false" ? "live" : "mock";
  const calendarDataSource =
    env.CALENDAR_DATA_SOURCE === "outlook" ? "outlook" : "mock";
  const dispatchDataSource = readDispatchDataSource(env.DISPATCH_DATA_SOURCE);

  if (mode === "live" && dispatchDataSource === "msp-central") {
    const missing = requiredLiveKeys.filter((key) => !env[key]);

    if (missing.length > 0) {
      throw new Error(
        `Missing dispatch integration environment variables: ${missing.join(", ")}`,
      );
    }
  }

  return {
    calendarDataSource,
    dispatchDataSource,
    mode,
    timezone: env.DEFAULT_TIMEZONE ?? "Australia/Melbourne",
    appBaseUrl: env.APP_BASE_URL,
    databaseUrl: env.DATABASE_URL,
    mspCentral: {
      baseUrl: env.MSP_CENTRAL_BASE_URL,
      portal: env.MSP_CENTRAL_PORTAL,
      clientId: env.MSP_CENTRAL_CLIENT_ID,
      clientSecret: env.MSP_CENTRAL_CLIENT_SECRET,
      refreshToken: env.MSP_CENTRAL_REFRESH_TOKEN,
      requestWebBaseUrl: env.MSP_CENTRAL_REQUEST_WEB_BASE_URL,
    },
    microsoft: {
      tenantId: env.MICROSOFT_TENANT_ID,
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      timezone: env.GRAPH_CALENDAR_TIMEZONE ?? "AUS Eastern Standard Time",
    },
  };
}

function readDispatchDataSource(value?: string): DispatchDataSource {
  if (
    value === "msp-central-fixture" ||
    value === "msp-central" ||
    value === "command-centre-db"
  ) {
    return value;
  }

  return "mock";
}

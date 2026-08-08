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
  trainingSamplesEnabled: boolean;
  timezone: string;
  appBaseUrl?: string;
  databaseUrl?: string;
  mspCentral: {
    baseUrl?: string;
    portal?: string;
    clientId?: string;
    clientSecret?: string;
    accountsUrl?: string;
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
] as const;

export function readDispatchConfig(env: DispatchEnv = process.env): DispatchConfig {
  const normalizedEnv = normalizeDispatchEnv(env);
  const mode =
    normalizedEnv.MOCK_INTEGRATIONS === "false" ? "live" : "mock";
  const calendarDataSource =
    normalizedEnv.CALENDAR_DATA_SOURCE === "outlook" ? "outlook" : "mock";
  const dispatchDataSource = readDispatchDataSource(
    normalizedEnv.DISPATCH_DATA_SOURCE,
  );

  if (mode === "live" && dispatchDataSource === "msp-central") {
    const missing = [
      ...requiredLiveKeys.filter((key) => !normalizedEnv[key]),
      ...missingMicrosoftCredentialAliases(normalizedEnv),
    ];

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
    trainingSamplesEnabled:
      normalizedEnv.COMMAND_CENTRE_TRAINING_SAMPLES === "true",
    timezone: normalizedEnv.DEFAULT_TIMEZONE ?? "Australia/Melbourne",
    appBaseUrl: normalizedEnv.APP_BASE_URL,
    databaseUrl: normalizedEnv.DATABASE_URL,
    mspCentral: {
      baseUrl: normalizedEnv.MSP_CENTRAL_BASE_URL,
      portal: normalizedEnv.MSP_CENTRAL_PORTAL,
      clientId: normalizedEnv.MSP_CENTRAL_CLIENT_ID,
      clientSecret: normalizedEnv.MSP_CENTRAL_CLIENT_SECRET,
      accountsUrl: normalizedEnv.MSP_CENTRAL_ACCOUNTS_URL,
      refreshToken: normalizedEnv.MSP_CENTRAL_REFRESH_TOKEN,
      requestWebBaseUrl: normalizedEnv.MSP_CENTRAL_REQUEST_WEB_BASE_URL,
    },
    microsoft: {
      tenantId:
        normalizedEnv.MICROSOFT_TENANT_ID ?? normalizedEnv.GRAPH_TENANT_ID,
      clientId:
        normalizedEnv.MICROSOFT_CLIENT_ID ?? normalizedEnv.GRAPH_CLIENT_ID,
      clientSecret:
        normalizedEnv.MICROSOFT_CLIENT_SECRET ?? normalizedEnv.GRAPH_CLIENT_SECRET,
      timezone:
        normalizedEnv.GRAPH_CALENDAR_TIMEZONE ??
        "AUS Eastern Standard Time",
    },
  };
}

function missingMicrosoftCredentialAliases(env: DispatchEnv) {
  return [
    env.MICROSOFT_TENANT_ID ?? env.GRAPH_TENANT_ID
      ? undefined
      : "MICROSOFT_TENANT_ID or GRAPH_TENANT_ID",
    env.MICROSOFT_CLIENT_ID ?? env.GRAPH_CLIENT_ID
      ? undefined
      : "MICROSOFT_CLIENT_ID or GRAPH_CLIENT_ID",
    env.MICROSOFT_CLIENT_SECRET ?? env.GRAPH_CLIENT_SECRET
      ? undefined
      : "MICROSOFT_CLIENT_SECRET or GRAPH_CLIENT_SECRET",
  ].filter(Boolean) as string[];
}

function normalizeDispatchEnv(env: DispatchEnv): DispatchEnv {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      cleanEnvironmentValue(value),
    ]),
  );
}

function cleanEnvironmentValue(value?: string) {
  const clean = value?.replace(
    /^[\s\u200B-\u200D\u2060]+|[\s\u200B-\u200D\u2060]+$/gu,
    "",
  );
  const unquoted =
    clean &&
    ((clean.startsWith('"') && clean.endsWith('"')) ||
      (clean.startsWith("'") && clean.endsWith("'")))
      ? clean.slice(1, -1).replace(
          /^[\s\u200B-\u200D\u2060]+|[\s\u200B-\u200D\u2060]+$/gu,
          "",
        )
      : clean;
  return unquoted || undefined;
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

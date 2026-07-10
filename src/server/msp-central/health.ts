import { readDispatchConfig, type DispatchConfig } from "@/server/dispatch/env";

import { loadMspCentralFixtureResponses } from "./fixtures";

const mspEnvKeys = [
  "MSP_CENTRAL_BASE_URL",
  "MSP_CENTRAL_PORTAL",
  "MSP_CENTRAL_CLIENT_ID",
  "MSP_CENTRAL_CLIENT_SECRET",
  "MSP_CENTRAL_REFRESH_TOKEN",
  "MSP_CENTRAL_REQUEST_WEB_BASE_URL",
] as const;

export type MspCentralReadinessStatus = {
  dataSource: DispatchConfig["dispatchDataSource"];
  env: Record<(typeof mspEnvKeys)[number], boolean>;
  fixtureFilesPresent: {
    requestDetail: boolean;
    requestList: boolean;
    technicianList: boolean;
  };
  liveApiConfigured: boolean;
  liveApiAttempted: boolean;
  mapperFixtureLoadOk: boolean;
  nextStep: string;
  ok: boolean;
};

export function getMspCentralReadinessStatus(
  env: Record<string, string | undefined> = process.env,
): MspCentralReadinessStatus {
  const config = readDispatchConfig(env);
  const envPresence = Object.fromEntries(
    mspEnvKeys.map((key) => [key, Boolean(env[key])]),
  ) as MspCentralReadinessStatus["env"];
  const liveApiConfigured = Boolean(
    config.mspCentral.baseUrl &&
      config.mspCentral.portal &&
      config.mspCentral.clientId &&
      config.mspCentral.clientSecret &&
      config.mspCentral.refreshToken,
  );
  let mapperFixtureLoadOk = false;

  try {
    const fixtures = loadMspCentralFixtureResponses();
    mapperFixtureLoadOk = Boolean(
      fixtures.requestList.requests?.length &&
        fixtures.requestDetail.request &&
        fixtures.technicianList.technicians?.length,
    );
  } catch {
    mapperFixtureLoadOk = false;
  }

  return {
    dataSource: config.dispatchDataSource,
    env: envPresence,
    fixtureFilesPresent: {
      requestDetail: true,
      requestList: true,
      technicianList: true,
    },
    liveApiAttempted: config.dispatchDataSource === "msp-central" && liveApiConfigured,
    liveApiConfigured,
    mapperFixtureLoadOk,
    nextStep: nextReadinessStep(config.dispatchDataSource, liveApiConfigured),
    ok: mapperFixtureLoadOk && config.dispatchDataSource !== "msp-central",
  };
}

function nextReadinessStep(
  dataSource: DispatchConfig["dispatchDataSource"],
  liveApiConfigured: boolean,
) {
  if (dataSource === "mock") {
    return "Waiting on MSP Central API access. Use fixture mode for mapper validation.";
  }

  if (dataSource === "msp-central-fixture") {
    return "Fixture mode ready. Replace sample JSON with sanitised MSP Central samples and rerun mapper tests.";
  }

  if (!liveApiConfigured) {
    return "Set MSP Central OAuth/API env vars before enabling live API mode.";
  }

  return "Live env vars are present, but live MSP Central API calls are intentionally not implemented yet.";
}

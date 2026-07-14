import { describe, expect, it } from "vitest";

import { readDispatchConfig } from "./env";

describe("dispatch runtime config", () => {
  it("defaults to mock integrations with the EGIT dispatch timezone", () => {
    const config = readDispatchConfig({});

    expect(config.mode).toBe("mock");
    expect(config.calendarDataSource).toBe("mock");
    expect(config.dispatchDataSource).toBe("mock");
    expect(config.timezone).toBe("Australia/Melbourne");
  });

  it("can select MSP Central fixture dispatch data without live API mode", () => {
    const config = readDispatchConfig({
      DISPATCH_DATA_SOURCE: "msp-central-fixture",
    });

    expect(config.dispatchDataSource).toBe("msp-central-fixture");
    expect(config.mode).toBe("mock");
  });

  it("can select the existing Command Centre database dispatch source", () => {
    const config = readDispatchConfig({
      DATABASE_URL: "postgresql://command-centre-db",
      DISPATCH_DATA_SOURCE: "command-centre-db",
    });

    expect(config.dispatchDataSource).toBe("command-centre-db");
    expect(config.databaseUrl).toBe("postgresql://command-centre-db");
  });

  it("can enable Outlook calendar reads without enabling MSP Central live mode", () => {
    const config = readDispatchConfig({
      CALENDAR_DATA_SOURCE: "outlook",
      GRAPH_CALENDAR_TIMEZONE: "AUS Eastern Standard Time",
      MICROSOFT_CLIENT_ID: "graph-client",
      MICROSOFT_CLIENT_SECRET: "graph-secret",
      MICROSOFT_TENANT_ID: "tenant",
    });

    expect(config.mode).toBe("mock");
    expect(config.calendarDataSource).toBe("outlook");
    expect(config.microsoft.timezone).toBe("AUS Eastern Standard Time");
  });

  it("does not require MSP Central secrets unless live MSP source is selected", () => {
    const config = readDispatchConfig({
      MOCK_INTEGRATIONS: "false",
      DISPATCH_DATA_SOURCE: "mock",
    });

    expect(config.mode).toBe("live");
    expect(config.dispatchDataSource).toBe("mock");
  });

  it("requires every live integration secret before live MSP Central mode can run", () => {
    expect(() =>
      readDispatchConfig({
        DISPATCH_DATA_SOURCE: "msp-central",
        MOCK_INTEGRATIONS: "false",
        DATABASE_URL: "postgresql://example",
        MSP_CENTRAL_BASE_URL: "https://msp.example",
      }),
    ).toThrow(/Missing dispatch integration environment variables/);
  });

  it("accepts complete live configuration without exposing browser env keys", () => {
    const config = readDispatchConfig({
      MOCK_INTEGRATIONS: "false",
      DATABASE_URL: "postgresql://example",
      DISPATCH_DATA_SOURCE: "msp-central",
      MSP_CENTRAL_BASE_URL: "https://msp.example",
      MSP_CENTRAL_PORTAL: "egit",
      MSP_CENTRAL_CLIENT_ID: "msp-client",
      MSP_CENTRAL_CLIENT_SECRET: "msp-secret",
      MSP_CENTRAL_REFRESH_TOKEN: "msp-refresh",
      MICROSOFT_TENANT_ID: "tenant",
      MICROSOFT_CLIENT_ID: "graph-client",
      MICROSOFT_CLIENT_SECRET: "graph-secret",
      APP_BASE_URL: "https://command.egit.com.au",
    });

    expect(config.mode).toBe("live");
    expect(config.dispatchDataSource).toBe("msp-central");
    expect(config.databaseUrl).toBe("postgresql://example");
    expect(config.mspCentral.baseUrl).toBe("https://msp.example");
    expect(config.microsoft.clientId).toBe("graph-client");
  });
});

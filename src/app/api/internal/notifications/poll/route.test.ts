import { beforeEach, describe, expect, it, vi } from "vitest";

import { readDispatchConfig } from "@/server/dispatch/env";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { createMspCentralClient } from "@/server/msp-central/client";
import { processTechnicianNotifications } from "@/server/notifications/poll";
import { getConfiguredNotificationRepository } from "@/server/notifications/repository";
import { cronAuthorized } from "@/server/yeastar/route-auth";

import { GET } from "./route";

vi.mock("@/server/dispatch/env", () => ({
  readDispatchConfig: vi.fn(),
}));
vi.mock("@/server/integrations/repository", () => ({
  createPostgresIntegrationRepository: vi.fn(),
}));
vi.mock("@/server/msp-central/client", () => ({
  createMspCentralClient: vi.fn(),
}));
vi.mock("@/server/notifications/poll", () => ({
  processTechnicianNotifications: vi.fn(),
}));
vi.mock("@/server/notifications/repository", () => ({
  getConfiguredNotificationRepository: vi.fn(),
}));
vi.mock("@/server/yeastar/route-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/yeastar/route-auth")>()),
  cronAuthorized: vi.fn(),
}));

const authorize = vi.mocked(cronAuthorized);
const config = vi.mocked(readDispatchConfig);
const createClient = vi.mocked(createMspCentralClient);
const createRepository = vi.mocked(createPostgresIntegrationRepository);
const getNotificationRepository = vi.mocked(getConfiguredNotificationRepository);
const processNotifications = vi.mocked(processTechnicianNotifications);
const listRequests = vi.fn();
const recordConnectorRead = vi.fn();

describe("technician notification poll route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorize.mockReturnValue(true);
    config.mockReturnValue({
      databaseUrl: "postgres://example",
      dispatchDataSource: "msp-central",
    } as never);
    getNotificationRepository.mockReturnValue({} as never);
    createClient.mockReturnValue({ listRequests } as never);
    createRepository.mockReturnValue({ recordConnectorRead } as never);
    listRequests.mockResolvedValue([]);
    recordConnectorRead.mockResolvedValue(undefined);
    processNotifications.mockResolvedValue({ notificationsSent: 0 } as never);
  });

  it("skips quietly while MSP Central OAuth refresh is temporarily throttled", async () => {
    listRequests.mockRejectedValueOnce(
      new Error("MSP Central OAuth refresh is temporarily throttled."),
    );

    const response = await GET(
      new Request("http://localhost/api/internal/notifications/poll"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      reason: "MSP Central OAuth refresh is temporarily throttled.",
      skipped: true,
    });
    expect(recordConnectorRead).toHaveBeenCalledWith({
      connector: "msp_central",
      error: "MSP Central OAuth refresh is temporarily throttled.",
      status: "degraded",
      succeeded: false,
    });
    expect(processNotifications).not.toHaveBeenCalled();
  });

  it("still reports real MSP Central poll failures", async () => {
    listRequests.mockRejectedValueOnce(new Error("MSP Central API request failed with status 401."));

    const response = await GET(
      new Request("http://localhost/api/internal/notifications/poll"),
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Technician notification poll failed." });
    expect(recordConnectorRead).toHaveBeenCalledWith({
      connector: "msp_central",
      error: "MSP Central API request failed with status 401.",
      status: "unavailable",
      succeeded: false,
    });
  });
});

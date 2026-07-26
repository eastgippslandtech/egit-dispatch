import { afterEach, describe, expect, it, vi } from "vitest";

import { readDispatchConfig } from "@/server/dispatch/env";

import { createMspCentralClient } from "./client";
import { MspCentralConfigurationError } from "./errors";

describe("MSP Central live client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes Zoho OAuth and lists live requests from the configured portal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "msp-access-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          requests: [
            {
              id: "123",
              request_number: "REQ-123",
              subject: "Printer offline",
              account: { name: "Example Co" },
              site: { name: "Bairnsdale office" },
              requester: { email: "client@example.com", name: "Client User" },
              priority: { name: "High" },
              status: { name: "Ready for Scheduling" },
              due_by_time: "2026-07-24T15:00:00+10:00",
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const client = createMspCentralClient(
      readDispatchConfig({
        DISPATCH_DATA_SOURCE: "msp-central",
        MSP_CENTRAL_ACCOUNTS_URL: "https://accounts.zoho.com.au",
        MSP_CENTRAL_BASE_URL: "https://mspcentral.manageengine.com.au",
        MSP_CENTRAL_CLIENT_ID: "client-id",
        MSP_CENTRAL_CLIENT_SECRET: "client-secret",
        MSP_CENTRAL_PORTAL: "memsp1783593801295",
        MSP_CENTRAL_REFRESH_TOKEN: "refresh-token",
      }),
    );

    const requests = await client.listRequests();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://accounts.zoho.com.au/oauth/v2/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        "https://mspcentral.manageengine.com.au/app/memsp1783593801295/api/v3/requests",
      ),
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/vnd.manageengine.sdp.v3+json",
          Authorization: "Zoho-oauthtoken msp-access-token",
        }),
        method: "GET",
      }),
    );
    expect(requests[0]).toMatchObject({
      customer: "Example Co",
      priority: "High",
      requestNumber: "REQ-123",
      sourceSystem: "msp-central",
      subject: "Printer offline",
    });
  });

  it("updates live request schedule fields with MSP Central input_data", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "msp-access-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response_status: { status: "success" } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const client = createMspCentralClient(
      readDispatchConfig({
        DISPATCH_DATA_SOURCE: "msp-central",
        MSP_CENTRAL_ACCOUNTS_URL: "https://accounts.zoho.com.au",
        MSP_CENTRAL_BASE_URL: "https://mspcentral.manageengine.com.au",
        MSP_CENTRAL_CLIENT_ID: "client-id",
        MSP_CENTRAL_CLIENT_SECRET: "client-secret",
        MSP_CENTRAL_PORTAL: "memsp1783593801295",
        MSP_CENTRAL_REFRESH_TOKEN: "refresh-token",
      }),
    );

    await client.updateRequestSchedule({
      requestId: "123",
      scheduledEnd: "2026-07-24T11:00:00+10:00",
      scheduledStart: "2026-07-24T10:00:00+10:00",
      technicianName: "Matt",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://mspcentral.manageengine.com.au/app/memsp1783593801295/api/v3/requests/123",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Zoho-oauthtoken msp-access-token",
        }),
      }),
    );
    const body = fetchMock.mock.calls[1][1].body as URLSearchParams;
    expect(JSON.parse(body.get("input_data") ?? "{}")).toEqual({
      request: {
        scheduled_end_time: { value: "2026-07-24T11:00:00+10:00" },
        scheduled_start_time: { value: "2026-07-24T10:00:00+10:00" },
        technician: { name: "Matt" },
      },
    });
  });

  it("reports the safe Zoho OAuth error code without exposing credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: "invalid_code" }),
      }),
    );

    const client = createMspCentralClient(
      readDispatchConfig({
        DISPATCH_DATA_SOURCE: "msp-central",
        MSP_CENTRAL_ACCOUNTS_URL: "https://accounts.zoho.com.au",
        MSP_CENTRAL_BASE_URL: "https://mspcentral.manageengine.com.au",
        MSP_CENTRAL_CLIENT_ID: "client-id",
        MSP_CENTRAL_CLIENT_SECRET: "client-secret",
        MSP_CENTRAL_PORTAL: "memsp1783593801295",
        MSP_CENTRAL_REFRESH_TOKEN: "refresh-token",
      }),
    );

    await expect(client.refreshAccessToken()).rejects.toEqual(
      new MspCentralConfigurationError(
        "MSP Central OAuth refresh failed (invalid_code).",
      ),
    );
  });
});

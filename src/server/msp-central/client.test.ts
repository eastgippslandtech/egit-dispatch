import { afterEach, describe, expect, it, vi } from "vitest";

import { readDispatchConfig } from "@/server/dispatch/env";

import {
  createMspCentralClient,
  resetMspCentralAccessTokenCacheForTests,
} from "./client";
import { MspCentralConfigurationError } from "./errors";

describe("MSP Central live client", () => {
  afterEach(() => {
    resetMspCentralAccessTokenCacheForTests();
    vi.useRealTimers();
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

  it("shares one Zoho token refresh across concurrent MSP reads", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/oauth/v2/token")) {
        return {
          ok: true,
          json: async () => ({ access_token: "msp-access-token" }),
        };
      }
      if (url.includes("/technicians")) {
        return {
          ok: true,
          json: async () => ({ technicians: [] }),
        };
      }
      return {
        ok: true,
        json: async () => ({ requests: [] }),
      };
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

    await Promise.all([client.listRequests(), client.listTechnicians()]);

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/oauth/v2/token"),
      ),
    ).toHaveLength(1);
  });

  it("reuses one Zoho access token across separate client instances", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/oauth/v2/token")) {
        return {
          ok: true,
          json: async () => ({
            access_token: "shared-access-token",
            expires_in: 3600,
          }),
        };
      }
      if (url.includes("/technicians")) {
        return {
          ok: true,
          json: async () => ({ technicians: [] }),
        };
      }
      return {
        ok: true,
        json: async () => ({ requests: [] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const config = readDispatchConfig({
      DISPATCH_DATA_SOURCE: "msp-central",
      MSP_CENTRAL_ACCOUNTS_URL: "https://accounts.zoho.com.au",
      MSP_CENTRAL_BASE_URL: "https://mspcentral.manageengine.com.au",
      MSP_CENTRAL_CLIENT_ID: "shared-client-id",
      MSP_CENTRAL_CLIENT_SECRET: "shared-client-secret",
      MSP_CENTRAL_PORTAL: "memsp1783593801295",
      MSP_CENTRAL_REFRESH_TOKEN: "shared-refresh-token",
    });

    await createMspCentralClient(config).listRequests();
    await createMspCentralClient(config).listTechnicians();

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/oauth/v2/token"),
      ),
    ).toHaveLength(1);
  });

  it("uses a still-valid token when an early refresh is throttled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T06:00:00.000Z"));
    let tokenRequests = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/oauth/v2/token")) {
        tokenRequests += 1;
        if (tokenRequests === 1) {
          return {
            ok: true,
            json: async () => ({
              access_token: "still-valid-access-token",
              expires_in: 120,
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({ error: "Access Denied" }),
        };
      }
      return {
        ok: true,
        json: async () => ({ requests: [] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const config = readDispatchConfig({
      DISPATCH_DATA_SOURCE: "msp-central",
      MSP_CENTRAL_ACCOUNTS_URL: "https://accounts.zoho.com.au",
      MSP_CENTRAL_BASE_URL: "https://mspcentral.manageengine.com.au",
      MSP_CENTRAL_CLIENT_ID: "fallback-client-id",
      MSP_CENTRAL_CLIENT_SECRET: "fallback-client-secret",
      MSP_CENTRAL_PORTAL: "memsp1783593801295",
      MSP_CENTRAL_REFRESH_TOKEN: "fallback-refresh-token",
    });

    await createMspCentralClient(config).listRequests();
    vi.advanceTimersByTime(70_000);
    await createMspCentralClient(config).listRequests();
    vi.advanceTimersByTime(10_000);
    await createMspCentralClient(config).listRequests();

    expect(tokenRequests).toBe(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/requests?"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Zoho-oauthtoken still-valid-access-token",
        }),
      }),
    );
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

  it("merges a duplicate child request into the surviving parent request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "msp-access-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response_status: {
            status: "success",
            status_code: 2000,
          },
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

    await client.mergeRequests({
      childRequestId: "duplicate-123",
      parentRequestId: "surviving-456",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://mspcentral.manageengine.com.au/app/memsp1783593801295/api/v3/requests/surviving-456/merge_requests",
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
      merge_requests: [{ id: "duplicate-123" }],
    });
  });

  it("does not accept an HTTP 200 merge response when MSP Central reports failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "msp-access-token" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            response_status: {
              messages: [{ message: "Merge was rejected" }],
              status: "failed",
              status_code: 4000,
            },
          }),
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

    await expect(
      client.mergeRequests({
        childRequestId: "duplicate-123",
        parentRequestId: "surviving-456",
      }),
    ).rejects.toEqual(
      new MspCentralConfigurationError("MSP Central request merge failed."),
    );
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

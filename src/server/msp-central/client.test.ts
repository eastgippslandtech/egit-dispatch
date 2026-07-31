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

  it("loads fresh request detail and separates customer responses from internal notes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "msp-access-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request: {
            customer: { name: "Client Company" },
            description: "<p>Current detailed job description.</p>",
            id: "123",
            request_number: "REQ-123",
            subject: "Printer offline",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_notes: [
            {
              created_by: { is_technician: false, name: "Client User" },
              created_time: { value: "1783501200000" },
              description: "<p>The printer is still offline.</p>",
              id: "note-customer",
              show_to_requester: true,
            },
            {
              created_by: { is_technician: true, name: "Simeon" },
              created_time: { value: "1783504800000" },
              description: "<p>Replacement part ordered.</p>",
              id: "note-internal",
              show_to_requester: false,
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

    const context = await client.getRequestContext("123");

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("/requests/123/notes"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(context.request).toMatchObject({
      customer: "Client Company",
      notes: "Current detailed job description.",
    });
    expect(context.customerResponses).toEqual([
      expect.objectContaining({
        author: "Client User",
        body: "The printer is still offline.",
      }),
    ]);
    expect(context.internalNotes).toEqual([
      expect.objectContaining({
        author: "Simeon",
        body: "Replacement part ordered.",
      }),
    ]);
  });

  it("does not discard an unexpired token when an endpoint returns unauthorized", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "valid-access-token",
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
      });
    vi.stubGlobal("fetch", fetchMock);
    const client = createMspCentralClient(
      readDispatchConfig({
        DISPATCH_DATA_SOURCE: "msp-central",
        MSP_CENTRAL_ACCOUNTS_URL: "https://accounts.zoho.com.au",
        MSP_CENTRAL_BASE_URL: "https://mspcentral.manageengine.com.au",
        MSP_CENTRAL_CLIENT_ID: "retry-client-id",
        MSP_CENTRAL_CLIENT_SECRET: "retry-client-secret",
        MSP_CENTRAL_PORTAL: "memsp1783593801295",
        MSP_CENTRAL_REFRESH_TOKEN: "retry-refresh-token",
      }),
    );

    await expect(client.listRequests()).rejects.toThrow(
      "MSP Central API request failed with status 401.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not discard a valid access token when MSP Central returns forbidden", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "valid-access-token",
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
      });
    vi.stubGlobal("fetch", fetchMock);
    const client = createMspCentralClient(
      readDispatchConfig({
        DISPATCH_DATA_SOURCE: "msp-central",
        MSP_CENTRAL_ACCOUNTS_URL: "https://accounts.zoho.com.au",
        MSP_CENTRAL_BASE_URL: "https://mspcentral.manageengine.com.au",
        MSP_CENTRAL_CLIENT_ID: "forbidden-client-id",
        MSP_CENTRAL_CLIENT_SECRET: "forbidden-client-secret",
        MSP_CENTRAL_PORTAL: "memsp1783593801295",
        MSP_CENTRAL_REFRESH_TOKEN: "forbidden-refresh-token",
      }),
    );

    await expect(client.listRequests()).rejects.toThrow(
      "MSP Central API request failed with status 403.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not discard a valid access token for an API-level access denial", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "valid-access-token",
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ error: "Access Denied" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const client = createMspCentralClient(
      readDispatchConfig({
        DISPATCH_DATA_SOURCE: "msp-central",
        MSP_CENTRAL_ACCOUNTS_URL: "https://accounts.zoho.com.au",
        MSP_CENTRAL_BASE_URL: "https://mspcentral.manageengine.com.au",
        MSP_CENTRAL_CLIENT_ID: "api-denied-client-id",
        MSP_CENTRAL_CLIENT_SECRET: "api-denied-client-secret",
        MSP_CENTRAL_PORTAL: "memsp1783593801295",
        MSP_CENTRAL_REFRESH_TOKEN: "api-denied-refresh-token",
      }),
    );

    await expect(client.listTechnicians()).rejects.toThrow(
      "MSP Central API request was denied.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it("loads every request page reported by MSP Central", async () => {
    const firstPage = Array.from({ length: 43 }, (_, index) => ({
      id: String(index + 1),
      request_number: `REQ-${index + 1}`,
      status: { name: "Open" },
      subject: `Request ${index + 1}`,
    }));
    const secondPage = Array.from({ length: 11 }, (_, index) => ({
      id: String(index + 44),
      request_number: `REQ-${index + 44}`,
      status: { name: "Open" },
      subject: `Request ${index + 44}`,
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "msp-access-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          list_info: {
            has_more_rows: true,
            row_count: 43,
            start_index: 1,
            total_count: 54,
          },
          requests: firstPage,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          list_info: {
            has_more_rows: false,
            row_count: 11,
            start_index: 44,
            total_count: 54,
          },
          requests: secondPage,
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

    expect(requests).toHaveLength(54);
    const secondRequestUrl = new URL(String(fetchMock.mock.calls[2]?.[0]));
    expect(JSON.parse(secondRequestUrl.searchParams.get("input_data") ?? "{}")).toMatchObject({
      list_info: { start_index: 44 },
    });
  });

  it("stops paging when MSP Central returns a textual false flag", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "msp-access-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          list_info: {
            has_more_rows: "false",
            row_count: "1",
            start_index: "1",
          },
          requests: [
            {
              id: "123",
              request_number: "REQ-123",
              status: { name: "Open" },
              subject: "Only request",
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

    await expect(client.listRequests()).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("adds charged time to a request Work Log", async () => {
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

    await client.addRequestWorklog?.({
      description: "Resolved printer fault.",
      durationMinutes: 95,
      endedAt: "2026-07-24T11:35:00+10:00",
      requestId: "123",
      startedAt: "2026-07-24T10:00:00+10:00",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://mspcentral.manageengine.com.au/app/memsp1783593801295/api/v3/requests/123/worklogs",
      expect.objectContaining({ method: "POST" }),
    );
    const body = fetchMock.mock.calls[1][1].body as URLSearchParams;
    expect(JSON.parse(body.get("input_data") ?? "{}")).toMatchObject({
      worklog: {
        description: "Resolved printer fault.",
        time_spent: { hours: "1", minutes: "35" },
      },
    });
  });

  it("assigns an MSP Central request to a technician", async () => {
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

    await client.assignRequest({
      requestId: "123",
      technicianName: "Jervy",
    });

    const body = fetchMock.mock.calls[1][1].body as URLSearchParams;
    expect(JSON.parse(body.get("input_data") ?? "{}")).toEqual({
      request: { technician: { name: "Jervy" } },
    });
    expect(fetchMock.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
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

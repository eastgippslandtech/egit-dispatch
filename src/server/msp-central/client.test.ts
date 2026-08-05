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
    const requestUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    const requestInput = JSON.parse(
      requestUrl.searchParams.get("input_data") ?? "{}",
    );
    expect(requestInput).toMatchObject({
      list_info: {
        row_count: 100,
        sort_field: "created_time",
        sort_order: "desc",
        start_index: 1,
      },
    });
    expect(requestInput.list_info).not.toHaveProperty("get_total_count");
    expect(requestInput.list_info).not.toHaveProperty("search_criteria");
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

  it("does not duplicate the portal path when the MSP API base already includes /app/<portal>", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "msp-access-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ requests: [] }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const client = createMspCentralClient(
      readDispatchConfig({
        DISPATCH_DATA_SOURCE: "msp-central",
        MSP_CENTRAL_ACCOUNTS_URL: "https://accounts.zoho.com.au",
        MSP_CENTRAL_BASE_URL:
          "https://servicedeskplus.net.au/app/memsp1783593801295",
        MSP_CENTRAL_CLIENT_ID: "client-id",
        MSP_CENTRAL_CLIENT_SECRET: "client-secret",
        MSP_CENTRAL_PORTAL: "memsp1783593801295",
        MSP_CENTRAL_REFRESH_TOKEN: "refresh-token",
      }),
    );

    await client.listRequests();

    const requestUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(requestUrl).toContain(
      "https://servicedeskplus.net.au/app/memsp1783593801295/api/v3/requests",
    );
    expect(requestUrl).not.toContain(
      "/app/memsp1783593801295/app/memsp1783593801295/",
    );
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
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ notifications: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          worklogs: [
            {
              description:
                "Legacy ConnectWise worklog: diagnosed the mail profile and rebuilt Outlook.",
              id: "legacy-worklog-1",
              owner: { name: "Riley Pearson" },
              recorded_time: { value: "1704067200000" },
              time_spent: { hours: "1", minutes: "15" },
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
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("/requests/123/notifications"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining("/requests/123/worklogs"),
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
    expect(context.worklogs).toEqual([
      expect.objectContaining({
        author: "Riley Pearson",
        body:
          "Legacy ConnectWise worklog: diagnosed the mail profile and rebuilt Outlook.",
        durationMinutes: 75,
      }),
    ]);
  });

  it("loads customer email replies from the MSP notification conversation", async () => {
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
            id: "123",
            request_number: "REQ-123",
            subject: "Printer offline",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          list_info: { has_more_rows: false },
          notes: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          list_info: { has_more_rows: false },
          notifications: [
            {
              sender: {
                email_id: "client@example.com",
                name: "Client User",
              },
              sent_time: { value: "1783501200000" },
              description: "<p>I have replied with the requested details.</p>",
              id: "email-reply-1",
              type: "reply",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ worklogs: [] }),
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

    expect(context.customerResponses).toEqual([
      expect.objectContaining({
        author: "Client User",
        body: "I have replied with the requested details.",
        id: "email-reply-1",
      }),
    ]);
  });

  it("loads every page of request notes and worklogs", async () => {
    const requestedStarts: Record<"notes" | "worklogs", number[]> = {
      notes: [],
      worklogs: [],
    };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/oauth/v2/token")) {
        return {
          ok: true,
          json: async () => ({ access_token: "msp-access-token" }),
        };
      }
      if (url.endsWith("/requests/123")) {
        return {
          ok: true,
          json: async () => ({
            request: {
              customer: { name: "Client Company" },
              description: "<p>Full request.</p>",
              id: "123",
              request_number: "REQ-123",
              subject: "Printer offline",
            },
          }),
        };
      }

      const requestUrl = new URL(url);
      const inputData = JSON.parse(
        requestUrl.searchParams.get("input_data") ?? "{}",
      ) as { list_info?: { start_index?: number } };
      const startIndex = inputData.list_info?.start_index ?? 1;

      if (requestUrl.pathname.endsWith("/notes")) {
        requestedStarts.notes.push(startIndex);
        return {
          ok: true,
          json: async () =>
            startIndex === 1
              ? {
                  list_info: { has_more_rows: true },
                  request_notes: [
                    {
                      created_by: { is_technician: false, name: "Customer One" },
                      created_time: { value: "1783501200000" },
                      description: "<p>First customer reply.</p>",
                      id: "note-1",
                    },
                    {
                      created_by: { is_technician: true, name: "Tech One" },
                      created_time: { value: "1783504800000" },
                      description: "<p>First internal note.</p>",
                      id: "note-2",
                    },
                  ],
                }
              : {
                  list_info: { has_more_rows: false },
                  request_notes: [
                    {
                      created_by: { is_technician: false, name: "Customer Two" },
                      created_time: { value: "1783508400000" },
                      description: "<p>Second customer reply.</p>",
                      id: "note-3",
                    },
                  ],
                },
        };
      }

      if (requestUrl.pathname.endsWith("/worklogs")) {
        requestedStarts.worklogs.push(startIndex);
        return {
          ok: true,
          json: async () =>
            startIndex === 1
              ? {
                  list_info: { has_more_rows: true },
                  worklogs: [
                    {
                      description: "First Work Log.",
                      id: "worklog-1",
                      owner: { name: "Tech One" },
                      recorded_time: { value: "1783512000000" },
                    },
                  ],
                }
              : {
                  list_info: { has_more_rows: false },
                  worklogs: [
                    {
                      description: "Second Work Log.",
                      id: "worklog-2",
                      owner: { name: "Tech Two" },
                      recorded_time: { value: "1783515600000" },
                    },
                  ],
                },
        };
      }

      throw new Error(`Unexpected MSP request: ${url}`);
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

    expect(requestedStarts.notes).toEqual([1, 3]);
    expect(requestedStarts.worklogs).toEqual([1, 2]);
    expect(context.customerResponses.map(({ id }) => id)).toEqual([
      "note-1",
      "note-3",
    ]);
    expect(context.internalNotes.map(({ id }) => id)).toEqual(["note-2"]);
    expect(context.worklogs.map(({ id }) => id)).toEqual([
      "worklog-1",
      "worklog-2",
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

  it("updates the live request technician and Scheduled status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "msp-access-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response_status: { status: "success" } }),
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
      technicianEmail: "mattd@egit.com.au",
      technicianId: "msp-tech-matt",
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
        status: { name: "Scheduled" },
        technician: { id: "msp-tech-matt" },
      },
    });

    await client.clearRequestSchedule({ requestId: "123" });
    const clearBody = fetchMock.mock.calls[2][1].body as URLSearchParams;
    expect(JSON.parse(clearBody.get("input_data") ?? "{}")).toEqual({
      request: {
        scheduled_end_time: null,
        scheduled_start_time: null,
      },
    });
  });

  it("includes MSP Central validation details in failed write errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "msp-access-token" }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          response_status: {
            messages: [{ message: "Invalid technician reference" }],
            status: "failed",
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

    await expect(
      client.updateRequestSchedule({
        requestId: "123",
        scheduledEnd: "2026-07-24T11:00:00+10:00",
        scheduledStart: "2026-07-24T10:00:00+10:00",
        technicianId: "invalid-technician",
      }),
    ).rejects.toThrow(
      "MSP Central API request failed with status 400: Invalid technician reference.",
    );
  });

  it("includes nested MSP Central field validation details from text responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "msp-access-token" }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            response_status: {
              messages: [
                {
                  fields: [
                    {
                      field: "worklog_type",
                      message: "The Work Log type is invalid",
                    },
                  ],
                },
              ],
              status: "failed",
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

    await expect(
      client.addRequestWorklog?.({
        description: "Test Work Log.",
        durationMinutes: 1,
        endedAt: "2026-08-01T10:01:00+10:00",
        ownerId: "msp-tech-simeon",
        requestId: "123",
        startedAt: "2026-08-01T10:00:00+10:00",
        worklogType: "billable",
      }),
    ).rejects.toThrow(
      "MSP Central API request failed with status 400: The Work Log type is invalid.",
    );
  });

  it("does not send schedule fields that are absent from the active request template", async () => {
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
      technicianId: "msp-tech-matt",
    });

    const requestBody = fetchMock.mock.calls[1][1].body as URLSearchParams;
    expect(JSON.parse(requestBody.get("input_data") ?? "{}")).toEqual({
      request: {
        status: { name: "Scheduled" },
        technician: { id: "msp-tech-matt" },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
      ownerId: "msp-tech-simeon",
      requestId: "123",
      startedAt: "2026-07-24T10:00:00+10:00",
      worklogType: "billable",
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
        is_billable: true,
        owner: { id: "msp-tech-simeon" },
        time_spent: { hours: "1", minutes: "45" },
      },
    });
  });

  it("sends customer Comms as a reply notification and keeps internal Comms as a note", async () => {
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
            id: "123",
            request_number: "REQ-123",
            requester: { email_id: "customer@example.com" },
            subject: "Printer offline",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response_status: { status: "success" } }),
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

    await client.addRequestReply?.({
      description: "Your printer is back online.",
      requestId: "123",
    });
    await client.addRequestNote?.({
      description: "Watch the switch port for errors.",
      requestId: "123",
      visibility: "internal",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("/requests/123/notifications"),
      expect.objectContaining({ method: "POST" }),
    );
    const customerBody = fetchMock.mock.calls[2][1].body as URLSearchParams;
    const internalBody = fetchMock.mock.calls[3][1].body as URLSearchParams;
    expect(JSON.parse(customerBody.get("input_data") ?? "{}")).toMatchObject({
      notification: {
        description: "Your printer is back online.",
        subject: "Re: [Request ID :##REQ-123##] : Printer offline",
        to: [{ email_id: "customer@example.com" }],
        type: "reply",
      },
    });
    expect(JSON.parse(internalBody.get("input_data") ?? "{}")).toMatchObject({
      request_note: {
        description: "Watch the switch port for errors.",
        notify_technician: false,
        show_to_requester: false,
      },
    });
  });

  it("creates a live Helpdesk request with the dispatcher supplied fields", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "msp-access-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request: { id: "456", request_number: "REQ-456" },
          response_status: { status: "success" },
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

    await expect(
      client.createRequest?.({
        customer: "Example Co",
        description: "Printer cannot reach the network.",
        priority: "High",
        requesterEmail: "user@example.com",
        site: "Bairnsdale office",
        subject: "Printer offline",
      }),
    ).resolves.toEqual({ id: "456", requestNumber: "REQ-456" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://mspcentral.manageengine.com.au/app/memsp1783593801295/api/v3/requests",
      expect.objectContaining({ method: "POST" }),
    );
    const body = fetchMock.mock.calls[1][1].body as URLSearchParams;
    expect(JSON.parse(body.get("input_data") ?? "{}")).toEqual({
      request: {
        account: { name: "Example Co" },
        description: "Printer cannot reach the network.",
        priority: { name: "High" },
        requester: { email_id: "user@example.com" },
        site: { name: "Bairnsdale office" },
        subject: "Printer offline",
      },
    });
  });

  it("adds a hidden deterministic marker and can find the created request", async () => {
    const marker = "a".repeat(64);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "msp-access-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request: { id: "456", request_number: "REQ-456" },
          response_status: { status: "success" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          requests: [
            {
              description: `Printer issue.\n<!-- command-centre:${marker} -->`,
              id: "456",
              request_number: "REQ-456",
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
        MSP_CENTRAL_CLIENT_ID: "marker-client-id",
        MSP_CENTRAL_CLIENT_SECRET: "client-secret",
        MSP_CENTRAL_PORTAL: "memsp1783593801295",
        MSP_CENTRAL_REFRESH_TOKEN: "marker-refresh-token",
      }),
    );

    await client.createRequest?.({
      commandFingerprint: marker,
      description: "Printer issue.",
      priority: "Medium",
      subject: "Printer offline",
    });
    await expect(
      client.findRequestByCommandFingerprint?.(marker),
    ).resolves.toEqual({ id: "456", requestNumber: "REQ-456" });

    const body = fetchMock.mock.calls[1][1].body as URLSearchParams;
    expect(JSON.parse(body.get("input_data") ?? "{}")).toMatchObject({
      request: {
        description: `Printer issue.\n<!-- command-centre:${marker} -->`,
      },
    });
  });

  it("rejects an HTTP 200 status update when MSP Central reports failure", async () => {
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
            response_status: { status: "failed" },
          }),
        }),
    );
    const client = createMspCentralClient(
      readDispatchConfig({
        DISPATCH_DATA_SOURCE: "msp-central",
        MSP_CENTRAL_ACCOUNTS_URL: "https://accounts.zoho.com.au",
        MSP_CENTRAL_BASE_URL: "https://mspcentral.manageengine.com.au",
        MSP_CENTRAL_CLIENT_ID: "status-client-id",
        MSP_CENTRAL_CLIENT_SECRET: "client-secret",
        MSP_CENTRAL_PORTAL: "memsp1783593801295",
        MSP_CENTRAL_REFRESH_TOKEN: "status-refresh-token",
      }),
    );

    await expect(
      client.updateRequestStatus?.({ requestId: "123", status: "Resolved" }),
    ).rejects.toThrow("MSP Central status update failed.");
  });

  it("rejects mixed MSP action statuses even when one entry says success", async () => {
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
            response_status: [
              { status: "success" },
              { status: "failed" },
            ],
          }),
        }),
    );
    const client = createMspCentralClient(
      readDispatchConfig({
        DISPATCH_DATA_SOURCE: "msp-central",
        MSP_CENTRAL_ACCOUNTS_URL: "https://accounts.zoho.com.au",
        MSP_CENTRAL_BASE_URL: "https://mspcentral.manageengine.com.au",
        MSP_CENTRAL_CLIENT_ID: "mixed-status-client-id",
        MSP_CENTRAL_CLIENT_SECRET: "client-secret",
        MSP_CENTRAL_PORTAL: "memsp1783593801295",
        MSP_CENTRAL_REFRESH_TOKEN: "mixed-status-refresh-token",
      }),
    );

    await expect(
      client.updateRequestStatus?.({ requestId: "123", status: "Resolved" }),
    ).rejects.toThrow("MSP Central status update failed.");
  });

  it("writes a completion solution onto the request", async () => {
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

    await client.setRequestResolution?.({
      content: "Replaced the failed power supply and tested printing.",
      requestId: "123",
    });

    const body = fetchMock.mock.calls[1][1].body as URLSearchParams;
    expect(JSON.parse(body.get("input_data") ?? "{}")).toEqual({
      request: {
        resolution: {
          content: "Replaced the failed power supply and tested printing.",
        },
      },
    });
  });

  it("rejects a completion solution when MSP Central rejects the action", async () => {
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
            messages: [{ message: "Resolution is not available in this template." }],
            status: "failed",
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const client = createMspCentralClient(
      readDispatchConfig({
        DISPATCH_DATA_SOURCE: "msp-central",
        MSP_CENTRAL_ACCOUNTS_URL: "https://accounts.zoho.com.au",
        MSP_CENTRAL_BASE_URL: "https://mspcentral.manageengine.com.au",
        MSP_CENTRAL_CLIENT_ID: "solution-client-id",
        MSP_CENTRAL_CLIENT_SECRET: "client-secret",
        MSP_CENTRAL_PORTAL: "memsp1783593801295",
        MSP_CENTRAL_REFRESH_TOKEN: "solution-refresh-token",
      }),
    );

    await expect(
      client.setRequestResolution?.({
        content: "Replaced the failed power supply.",
        requestId: "123",
      }),
    ).rejects.toThrow("MSP Central solution save failed.");
  });

  it.each([
    ["billable", true],
    ["non_billable", false],
    ["internal", false],
  ] as const)("maps %s Work Logs to the MSP billable flag", async (worklogType, expectedBillable) => {
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
      description: "Tested Work Log type.",
      durationMinutes: 15,
      endedAt: "2026-08-01T10:15:00+10:00",
      ownerId: "msp-tech-simeon",
      requestId: "123",
      startedAt: "2026-08-01T10:00:00+10:00",
      worklogType,
    });

    const body = fetchMock.mock.calls[1][1].body as URLSearchParams;
    expect(JSON.parse(body.get("input_data") ?? "{}")).toMatchObject({
      worklog: {
        is_billable: expectedBillable,
        owner: { id: "msp-tech-simeon" },
      },
    });
    expect(
      JSON.parse(body.get("input_data") ?? "{}").worklog.worklog_type,
    ).toBeUndefined();
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

  it("prefers the MSP technician email when assigning a request", async () => {
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
      technicianEmail: "mattd@egit.com.au",
      technicianName: "Matt",
    });

    const body = fetchMock.mock.calls[1][1].body as URLSearchParams;
    expect(JSON.parse(body.get("input_data") ?? "{}")).toEqual({
      request: { technician: { email_id: "mattd@egit.com.au" } },
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

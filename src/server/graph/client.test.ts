import { describe, expect, it, vi } from "vitest";

import { GraphApiError, createGraphClient } from "./client";

describe("Graph client", () => {
  it("uses client credentials and calendarView with the configured timezone", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token-value" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: [] }),
      });

    const client = createGraphClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl: fetchMock,
      tenantId: "tenant-id",
      timezone: "AUS Eastern Standard Time",
    });

    await client.listCalendarView({
      endDateTime: "2026-07-09T00:00:00",
      startDateTime: "2026-07-08T00:00:00",
      userPrincipalName: "simeon@egit.com.au",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        "/users/simeon%40egit.com.au/calendar/calendarView?startDateTime=2026-07-08T00%3A00%3A00&endDateTime=2026-07-09T00%3A00%3A00",
      ),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-value",
          Prefer: 'outlook.timezone="AUS Eastern Standard Time"',
        }),
        method: "GET",
      }),
    );
  });

  it("throws safe errors without leaking secrets or tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () =>
        "invalid client_secret=super-secret access_token=token-value",
    });

    const client = createGraphClient({
      clientId: "client-id",
      clientSecret: "super-secret",
      fetchImpl: fetchMock,
      tenantId: "tenant-id",
    });

    await expect(client.acquireToken()).rejects.toThrow(GraphApiError);
    await expect(client.acquireToken()).rejects.not.toThrow("super-secret");
    await expect(client.acquireToken()).rejects.not.toThrow("token-value");
  });
});

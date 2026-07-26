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

  it("creates and updates Outlook events with application calendar write access", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token-value" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: "event-1", webLink: "https://outlook/event-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "event-1", webLink: "https://outlook/event-1" }),
      });

    const client = createGraphClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl: fetchMock,
      tenantId: "tenant-id",
      timezone: "AUS Eastern Standard Time",
    });

    await client.createEvent({
      bodyPreview: "REQ-123",
      end: "2026-07-24T11:00:00",
      location: "Bairnsdale office",
      start: "2026-07-24T10:00:00",
      subject: "REQ-123 Printer offline",
      userPrincipalName: "mattd@egit.com.au",
    });
    await client.updateEvent({
      bodyPreview: "REQ-123 moved",
      end: "2026-07-24T12:00:00",
      eventId: "event-1",
      location: "Bairnsdale office",
      start: "2026-07-24T11:00:00",
      subject: "REQ-123 Printer offline",
      userPrincipalName: "mattd@egit.com.au",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://graph.microsoft.com/v1.0/users/mattd%40egit.com.au/events",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token-value",
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toMatchObject({
      body: { contentType: "text", content: "REQ-123" },
      end: { dateTime: "2026-07-24T11:00:00", timeZone: "AUS Eastern Standard Time" },
      location: { displayName: "Bairnsdale office" },
      start: { dateTime: "2026-07-24T10:00:00", timeZone: "AUS Eastern Standard Time" },
      subject: "REQ-123 Printer offline",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://graph.microsoft.com/v1.0/users/mattd%40egit.com.au/events/event-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("shares one access-token request across concurrent calendar reads", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("/oauth2/v2.0/token")
        ? {
            ok: true,
            json: async () => ({ access_token: "token-value" }),
          }
        : {
            ok: true,
            json: async () => ({ value: [] }),
          },
    );
    const client = createGraphClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl: fetchMock,
      tenantId: "tenant-id",
    });

    await Promise.all([
      client.listCalendarView({
        endDateTime: "2026-07-09T00:00:00",
        startDateTime: "2026-07-08T00:00:00",
        userPrincipalName: "mattd@egit.com.au",
      }),
      client.listCalendarView({
        endDateTime: "2026-07-09T00:00:00",
        startDateTime: "2026-07-08T00:00:00",
        userPrincipalName: "jervy@egit.com.au",
      }),
    ]);

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/oauth2/v2.0/token"),
      ),
    ).toHaveLength(1);
  });
});

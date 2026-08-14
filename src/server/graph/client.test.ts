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
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
    const calendarUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(calendarUrl.pathname).toBe(
      "/v1.0/users/simeon%40egit.com.au/calendar/calendarView",
    );
    expect(calendarUrl.searchParams.get("startDateTime")).toBe(
      "2026-07-08T00:00:00",
    );
    expect(calendarUrl.searchParams.get("endDateTime")).toBe(
      "2026-07-09T00:00:00",
    );
    expect(calendarUrl.searchParams.get("$top")).toBe("50");
    expect(calendarUrl.searchParams.get("$select")).toContain("bodyPreview");
    expect(calendarUrl.searchParams.get("$select")).not.toContain("body,");
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-value",
          Prefer: 'outlook.timezone="AUS Eastern Standard Time"',
        }),
        method: "GET",
      }),
    );
  });

  it("follows calendarView pagination so busy calendars return every event", async () => {
    const nextLink =
      "https://graph.microsoft.com/v1.0/users/jervy%40egit.com.au/calendar/calendarView?$skiptoken=next-page";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token-value" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          "@odata.nextLink": nextLink,
          value: [{ id: "event-1", subject: "Earlier booking" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: [{ id: "event-2", subject: "Command centre training" }],
        }),
      });

    const client = createGraphClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl: fetchMock,
      tenantId: "tenant-id",
    });

    const events = await client.listCalendarView({
      endDateTime: "2026-08-01T00:00:00",
      startDateTime: "2026-07-27T00:00:00",
      userPrincipalName: "jervy@egit.com.au",
    });

    expect(events.map((event) => event.id)).toEqual(["event-1", "event-2"]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      nextLink,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-value",
        }),
        method: "GET",
        signal: expect.any(AbortSignal),
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

  it("creates, updates, and deletes Outlook events with application calendar write access", async () => {
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
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
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
      transactionId: "worklog-outcome-123",
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
    await client.deleteEvent({
      eventId: "event-1",
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
      transactionId: "worklog-outcome-123",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://graph.microsoft.com/v1.0/users/mattd%40egit.com.au/events/event-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "https://graph.microsoft.com/v1.0/users/mattd%40egit.com.au/events/event-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("sends technician schedule emails through Microsoft Graph sendMail", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token-value" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
      });

    const client = createGraphClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl: fetchMock,
      tenantId: "tenant-id",
    });

    await client.sendMail({
      fromUserPrincipalName: "support@egit.com.au",
      html: "<p>Ticket scheduled</p>",
      plainText: "Ticket scheduled",
      subject: "Scheduled: 22240 RSS job",
      to: "jervy@egit.com.au",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://graph.microsoft.com/v1.0/users/support%40egit.com.au/sendMail",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token-value",
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({
      message: {
        body: {
          content: "<p>Ticket scheduled</p>",
          contentType: "HTML",
        },
        subject: "Scheduled: 22240 RSS job",
        toRecipients: [
          {
            emailAddress: {
              address: "jervy@egit.com.au",
            },
          },
        ],
      },
      saveToSentItems: true,
    });
  });

  it("explains when technician email is missing the Microsoft Graph Mail.Send app role", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: fakeGraphToken(["Calendars.Read", "Calendars.ReadWrite"]),
      }),
    });
    const client = createGraphClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl: fetchMock,
      tenantId: "tenant-id",
    });

    await expect(
      client.sendMail({
        fromUserPrincipalName: "support@egit.com.au",
        plainText: "Ticket scheduled",
        subject: "Scheduled: 22240 RSS job",
        to: "jervy@egit.com.au",
      }),
    ).rejects.toThrow(
      "Microsoft Graph Mail.Send application permission is not granted for technician email.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends technician email when the Graph token includes Mail.Send", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: fakeGraphToken([
            "Calendars.ReadWrite",
            "Mail.Send",
          ]),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
      });
    const client = createGraphClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl: fetchMock,
      tenantId: "tenant-id",
    });

    await client.sendMail({
      fromUserPrincipalName: "support@egit.com.au",
      plainText: "Ticket scheduled",
      subject: "Scheduled: 22240 RSS job",
      to: "jervy@egit.com.au",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://graph.microsoft.com/v1.0/users/support%40egit.com.au/sendMail",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reads one Outlook event for mobile schedule detail", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token-value" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          end: { dateTime: "2026-07-24T11:00:00" },
          id: "event/with+characters",
          start: { dateTime: "2026-07-24T10:00:00" },
          subject: "Command Centre training",
        }),
      });
    const client = createGraphClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl: fetchMock,
      tenantId: "tenant-id",
    });

    const event = await client.getEvent({
      eventId: "event/with+characters",
      userPrincipalName: "riley@egit.com.au",
    });

    expect(event.subject).toBe("Command Centre training");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://graph.microsoft.com/v1.0/users/riley%40egit.com.au/events/event%2Fwith%2Bcharacters",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer token-value",
        }),
      }),
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

function fakeGraphToken(roles: string[]) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64url");
  return [
    encode({ alg: "none", typ: "JWT" }),
    encode({ roles }),
    "signature",
  ].join(".");
}

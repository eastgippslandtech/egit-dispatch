import { describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { createGraphClient } from "@/server/graph/client";

import { POST } from "./route";

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

vi.mock("@/server/graph/client", () => ({
  createGraphClient: vi.fn(),
}));

const getCommandCentreAccessMock = vi.mocked(getCommandCentreAccess);
const createGraphClientMock = vi.mocked(createGraphClient);

describe("internal Graph events route", () => {
  it("rejects a wallboard-only session", async () => {
    getCommandCentreAccessMock.mockResolvedValueOnce({
      name: "Command Centre Wallboard",
      status: "wallboard-only",
    });

    const response = await POST(
      new Request("https://command.egit.com.au/api/internal/graph/events", {
        body: "{}",
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
  });

  it("creates an Outlook event for an approved dispatcher", async () => {
    const createEvent = vi.fn().mockResolvedValue({
      id: "event-1",
      webLink: "https://outlook/event-1",
    });
    getCommandCentreAccessMock.mockResolvedValue({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
    createGraphClientMock.mockReturnValue({
      acquireToken: vi.fn(),
      createEvent,
      listCalendarView: vi.fn(),
      updateEvent: vi.fn(),
    });

    const response = await POST(
      new Request("https://command.egit.com.au/api/internal/graph/events", {
        body: JSON.stringify({
          bodyPreview: "REQ-123",
          end: "2026-07-24T11:00:00",
          location: "Bairnsdale office",
          start: "2026-07-24T10:00:00",
          subject: "REQ-123 Printer offline",
          userPrincipalName: "mattd@egit.com.au",
        }),
        method: "POST",
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      event: {
        id: "event-1",
        webLink: "https://outlook/event-1",
      },
      ok: true,
    });
    expect(createEvent).toHaveBeenCalledWith({
      bodyPreview: "REQ-123",
      end: "2026-07-24T11:00:00",
      location: "Bairnsdale office",
      start: "2026-07-24T10:00:00",
      subject: "REQ-123 Printer offline",
      userPrincipalName: "mattd@egit.com.au",
    });
  });

  it("updates an existing Outlook event when an event id is supplied", async () => {
    const updateEvent = vi.fn().mockResolvedValue({
      id: "event-1",
      webLink: "https://outlook/event-1",
    });
    getCommandCentreAccessMock.mockResolvedValue({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
    createGraphClientMock.mockReturnValue({
      acquireToken: vi.fn(),
      createEvent: vi.fn(),
      listCalendarView: vi.fn(),
      updateEvent,
    });

    const response = await POST(
      new Request("https://command.egit.com.au/api/internal/graph/events", {
        body: JSON.stringify({
          bodyPreview: "REQ-123 moved",
          end: "2026-07-24T12:00:00",
          eventId: "event-1",
          location: "Bairnsdale office",
          start: "2026-07-24T11:00:00",
          subject: "REQ-123 Printer offline",
          userPrincipalName: "mattd@egit.com.au",
        }),
        method: "POST",
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      event: {
        id: "event-1",
      },
      ok: true,
    });
    expect(updateEvent).toHaveBeenCalledWith({
      bodyPreview: "REQ-123 moved",
      end: "2026-07-24T12:00:00",
      eventId: "event-1",
      location: "Bairnsdale office",
      start: "2026-07-24T11:00:00",
      subject: "REQ-123 Printer offline",
      userPrincipalName: "mattd@egit.com.au",
    });
  });
});

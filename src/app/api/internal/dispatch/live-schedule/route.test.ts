import { describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { createGraphClient } from "@/server/graph/client";
import { createMspCentralClient } from "@/server/msp-central/client";

import { POST } from "./route";

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

vi.mock("@/server/graph/client", () => ({
  createGraphClient: vi.fn(),
}));

vi.mock("@/server/msp-central/client", () => ({
  createMspCentralClient: vi.fn(),
}));

const getCommandCentreAccessMock = vi.mocked(getCommandCentreAccess);
const createGraphClientMock = vi.mocked(createGraphClient);
const createMspCentralClientMock = vi.mocked(createMspCentralClient);

describe("live dispatch schedule route", () => {
  it("rejects a wallboard-only session", async () => {
    getCommandCentreAccessMock.mockResolvedValueOnce({
      name: "Command Centre Wallboard",
      status: "wallboard-only",
    });

    const response = await POST(
      new Request("https://command.egit.com.au/api/internal/dispatch/live-schedule", {
        body: "{}",
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
  });

  it("creates an Outlook event and updates MSP Central request schedule", async () => {
    const createEvent = vi.fn().mockResolvedValue({
      id: "event-1",
      webLink: "https://outlook/event-1",
    });
    const updateRequestSchedule = vi.fn().mockResolvedValue(undefined);
    const getRequest = vi.fn().mockResolvedValue({
      id: "123",
      sourceSystem: "msp-central",
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
    createMspCentralClientMock.mockReturnValue({
      getRequest,
      getTechnician: vi.fn(),
      listCustomers: vi.fn(),
      listRequests: vi.fn(),
      listSites: vi.fn(),
      listTechnicians: vi.fn(),
      refreshAccessToken: vi.fn(),
      updateRequestSchedule,
    });

    const response = await POST(
      new Request("https://command.egit.com.au/api/internal/dispatch/live-schedule", {
        body: JSON.stringify({
          customer: "Example Co",
          bookingType: "Onsite",
          date: "2026-07-24",
          end: "11:00",
          location: "Bairnsdale office",
          requestId: "123",
          requestNumber: "REQ-123",
          start: "10:00",
          subject: "Printer offline",
          technicianName: "Matt",
          technicianEmail: "mattd@egit.com.au",
          technicianMspCentralId: "msp-tech-matt",
          userPrincipalName: "mattd@egit.com.au",
        }),
        method: "POST",
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      event: { id: "event-1" },
      ok: true,
    });
    expect(createEvent).toHaveBeenCalledWith({
      bodyPreview:
        "Request: REQ-123\nCompany: Example Co\nSite: Bairnsdale office\nBooking Type: Onsite",
      end: "2026-07-24T11:00:00",
      location: "Bairnsdale office",
      start: "2026-07-24T10:00:00",
      subject: "REQ-123 Printer offline",
      userPrincipalName: "mattd@egit.com.au",
    });
    expect(updateRequestSchedule).toHaveBeenCalledWith({
      requestId: "123",
      scheduledEnd: "2026-07-24T11:00:00+10:00",
      scheduledStart: "2026-07-24T10:00:00+10:00",
      technicianEmail: "mattd@egit.com.au",
      technicianId: "msp-tech-matt",
      technicianName: "Matt",
    });
    expect(getRequest.mock.invocationCallOrder[0]).toBeLessThan(
      createEvent.mock.invocationCallOrder[0],
    );
    expect(updateRequestSchedule.mock.invocationCallOrder[0]).toBeLessThan(
      createEvent.mock.invocationCallOrder[0],
    );
  });

  it("does not create an Outlook event when the Helpdesk request is missing", async () => {
    const createEvent = vi.fn();
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
    createMspCentralClientMock.mockReturnValue({
      getRequest: vi.fn().mockResolvedValue(undefined),
      getTechnician: vi.fn(),
      listCustomers: vi.fn(),
      listRequests: vi.fn(),
      listSites: vi.fn(),
      listTechnicians: vi.fn(),
      refreshAccessToken: vi.fn(),
      updateRequestSchedule: vi.fn(),
    });

    const response = await POST(
      new Request("https://command.egit.com.au/api/internal/dispatch/live-schedule", {
        body: JSON.stringify({
          date: "2026-07-24",
          end: "11:00",
          requestId: "missing",
          requestNumber: "REQ-MISSING",
          start: "10:00",
          subject: "Missing request",
          userPrincipalName: "mattd@egit.com.au",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(createEvent).not.toHaveBeenCalled();
  });
});

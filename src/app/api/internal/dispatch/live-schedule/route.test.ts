import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { recordDispatchTestSyncEvent } from "@/server/dispatch/test-sync";
import { getConfiguredDispatchLinkStore } from "@/server/dispatch/link-store";
import { createGraphClient } from "@/server/graph/client";
import { createMspCentralClient } from "@/server/msp-central/client";

import { POST } from "./route";

const afterTasks = vi.hoisted(
  () => [] as Array<() => Promise<unknown> | unknown>,
);

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn((task: () => Promise<unknown> | unknown) => {
    afterTasks.push(task);
  }),
}));

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

vi.mock("@/server/graph/client", () => ({
  createGraphClient: vi.fn(),
}));

vi.mock("@/server/dispatch/test-sync", () => ({
  recordDispatchTestSyncEvent: vi.fn(),
}));

vi.mock("@/server/dispatch/link-store", () => ({
  getConfiguredDispatchLinkStore: vi.fn(),
}));

vi.mock("@/server/msp-central/client", () => ({
  createMspCentralClient: vi.fn(),
}));

const getCommandCentreAccessMock = vi.mocked(getCommandCentreAccess);
const recordDispatchTestSyncEventMock = vi.mocked(recordDispatchTestSyncEvent);
const createGraphClientMock = vi.mocked(createGraphClient);
const createMspCentralClientMock = vi.mocked(createMspCentralClient);
const getConfiguredDispatchLinkStoreMock = vi.mocked(
  getConfiguredDispatchLinkStore,
);

describe("live dispatch schedule route", () => {
  beforeEach(() => {
    afterTasks.length = 0;
    vi.clearAllMocks();
    getConfiguredDispatchLinkStoreMock.mockReturnValue(null);
    recordDispatchTestSyncEventMock.mockImplementation(async (event) => ({
      ...event,
      createdAt: "2026-07-24T00:00:00.000Z",
      eventType: event.eventType ?? "scheduled",
      id: event.id ?? "live-schedule-event",
    }));
  });

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

  it("persists immediately and queues Outlook plus MSP Central status sync", async () => {
    const createEvent = vi.fn().mockResolvedValue({
      id: "event-1",
      webLink: "https://outlook/event-1",
    });
    const updateRequestSchedule = vi.fn().mockResolvedValue(undefined);
    const saveLink = vi.fn().mockResolvedValue(undefined);
    getConfiguredDispatchLinkStoreMock.mockReturnValue({ save: saveLink });
    getCommandCentreAccessMock.mockResolvedValue({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
    createGraphClientMock.mockReturnValue({
      acquireToken: vi.fn(),
      createEvent,
      deleteEvent: vi.fn(),
      getEvent: vi.fn(),
      listCalendarView: vi.fn(),
      updateEvent: vi.fn(),
    });
    createMspCentralClientMock.mockReturnValue({
      assignRequest: vi.fn(),
      clearRequestSchedule: vi.fn(),
      getRequest: vi.fn(),
      getRequestContext: vi.fn(),
      getTechnician: vi.fn(),
      listCustomers: vi.fn(),
      listRequests: vi.fn(),
      listSites: vi.fn(),
      listTechnicians: vi.fn(),
      mergeRequests: vi.fn(),
      refreshAccessToken: vi.fn(),
      updateRequestSchedule,
    });

    const response = await POST(
      new Request("https://command.egit.com.au/api/internal/dispatch/live-schedule", {
        body: JSON.stringify({
          customer: "Example Co",
          appointmentId: "pending-live-123",
          bookingType: "Onsite",
          date: "2026-07-24",
          end: "11:00",
          location: "Bairnsdale office",
          requestId: "123",
          requestNumber: "REQ-123",
          start: "10:00",
          subject: "Printer offline",
          technicianId: "tech-matt",
          technicianName: "Matt",
          technicianEmail: "mattd@egit.com.au",
          technicianMspCentralId: "msp-tech-matt",
          userPrincipalName: "mattd@egit.com.au",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      queued: true,
    });
    expect(recordDispatchTestSyncEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: "pending-live-123",
        eventType: "scheduled",
        payload: expect.objectContaining({
          liveSync: { status: "pending" },
        }),
        requestId: "123",
        technicianId: "tech-matt",
      }),
      "simeon@egit.com.au",
    );
    expect(createEvent).not.toHaveBeenCalled();
    expect(updateRequestSchedule).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(1);

    await afterTasks[0]();

    expect(createEvent).toHaveBeenCalledWith({
      bodyPreview:
        "Request: REQ-123\nCompany: Example Co\nSite: Bairnsdale office\nBooking Type: Onsite",
      end: "2026-07-24T11:00:00",
      location: "Bairnsdale office",
      start: "2026-07-24T10:00:00",
      subject: "Printer offline",
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
    expect(recordDispatchTestSyncEventMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "live-schedule-pending-live-123",
        payload: expect.objectContaining({
          liveSync: {
            outlookEventId: "event-1",
            outlookWebLink: "https://outlook/event-1",
            status: "synced",
          },
        }),
      }),
      "simeon@egit.com.au",
    );
    expect(saveLink).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingType: "Onsite",
        outlookEventId: "event-1",
        requestId: "123",
        requestNumber: "REQ-123",
        scheduledEnd: "2026-07-24T11:00:00+10:00",
        scheduledStart: "2026-07-24T10:00:00+10:00",
        syncStatus: "linked",
        technicianEmail: "mattd@egit.com.au",
      }),
    );
  });

  it("assigns MSP Central to the lead and creates Outlook bookings for every crew member", async () => {
    const createEvent = vi
      .fn()
      .mockResolvedValueOnce({
        id: "event-lead",
        webLink: "https://outlook/event-lead",
      })
      .mockResolvedValueOnce({
        id: "event-crew",
        webLink: "https://outlook/event-crew",
      });
    const updateRequestSchedule = vi.fn().mockResolvedValue(undefined);
    const deleteEvent = vi.fn().mockResolvedValue(undefined);
    const saveLink = vi.fn().mockResolvedValue(undefined);
    getConfiguredDispatchLinkStoreMock.mockReturnValue({ save: saveLink });
    getCommandCentreAccessMock.mockResolvedValue({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
    createGraphClientMock.mockReturnValue({
      acquireToken: vi.fn(),
      createEvent,
      deleteEvent,
      getEvent: vi.fn(),
      listCalendarView: vi.fn(),
      updateEvent: vi.fn(),
    });
    createMspCentralClientMock.mockReturnValue({
      assignRequest: vi.fn(),
      clearRequestSchedule: vi.fn(),
      getRequest: vi.fn(),
      getRequestContext: vi.fn(),
      getTechnician: vi.fn(),
      listCustomers: vi.fn(),
      listRequests: vi.fn(),
      listSites: vi.fn(),
      listTechnicians: vi.fn(),
      mergeRequests: vi.fn(),
      refreshAccessToken: vi.fn(),
      updateRequestSchedule,
    });

    const response = await POST(
      new Request("https://command.egit.com.au/api/internal/dispatch/live-schedule", {
        body: JSON.stringify({
          appointmentId: "pending-live-team-123",
          bookingType: "Onsite",
          crew: [
            {
              technicianEmail: "jervy@egit.com.au",
              technicianId: "tech-jervy",
              technicianName: "Jervy",
              userPrincipalName: "jervy@egit.com.au",
            },
          ],
          customer: "Example Co",
          date: "2026-07-24",
          end: "11:00",
          location: "Bairnsdale office",
          previousAssignments: [
            {
              eventId: "event-riley-old",
              technicianId: "tech-riley",
              userPrincipalName: "riley@egit.com.au",
            },
          ],
          requestId: "123",
          requestNumber: "REQ-123",
          start: "10:00",
          subject: "Printer offline",
          technicianId: "tech-matt",
          technicianName: "Matt Doyle",
          technicianEmail: "mattd@egit.com.au",
          technicianMspCentralId: "msp-tech-matt",
          userPrincipalName: "mattd@egit.com.au",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(202);
    expect(afterTasks).toHaveLength(1);
    await afterTasks[0]();

    expect(updateRequestSchedule).toHaveBeenCalledTimes(1);
    expect(updateRequestSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "123",
        technicianEmail: "mattd@egit.com.au",
        technicianId: "msp-tech-matt",
      }),
    );
    expect(createEvent).toHaveBeenCalledTimes(2);
    expect(createEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ userPrincipalName: "mattd@egit.com.au" }),
    );
    expect(deleteEvent).toHaveBeenCalledWith({
      eventId: "event-riley-old",
      userPrincipalName: "riley@egit.com.au",
    });
    expect(createEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ userPrincipalName: "jervy@egit.com.au" }),
    );
    expect(saveLink).toHaveBeenCalledWith(
      expect.objectContaining({
        crew: [
          expect.objectContaining({
            outlookCalendarEmail: "jervy@egit.com.au",
            outlookEventId: "event-crew",
            technicianEmail: "jervy@egit.com.au",
            technicianId: "tech-jervy",
          }),
        ],
        outlookEventId: "event-lead",
        technicianEmail: "mattd@egit.com.au",
      }),
    );
  });

  it("rejects duplicate lead and crew technicians", async () => {
    getCommandCentreAccessMock.mockResolvedValue({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });

    const response = await POST(
      new Request("https://command.egit.com.au/api/internal/dispatch/live-schedule", {
        body: JSON.stringify({
          appointmentId: "pending-live-team-duplicate",
          crew: [
            {
              technicianId: "tech-matt",
              technicianName: "Matt Doyle",
              userPrincipalName: "mattd@egit.com.au",
            },
          ],
          date: "2026-07-24",
          end: "11:00",
          requestId: "123",
          requestNumber: "REQ-123",
          start: "10:00",
          subject: "Printer offline",
          technicianId: "tech-matt",
          technicianName: "Matt Doyle",
          userPrincipalName: "mattd@egit.com.au",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "A technician can only be selected once.",
    });
    expect(afterTasks).toHaveLength(0);
  });

  it("does not queue a schedule without local appointment identity", async () => {
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
      deleteEvent: vi.fn(),
      getEvent: vi.fn(),
      listCalendarView: vi.fn(),
      updateEvent: vi.fn(),
    });
    createMspCentralClientMock.mockReturnValue({
      assignRequest: vi.fn(),
      clearRequestSchedule: vi.fn(),
      getRequest: vi.fn(),
      getRequestContext: vi.fn(),
      getTechnician: vi.fn(),
      listCustomers: vi.fn(),
      listRequests: vi.fn(),
      listSites: vi.fn(),
      listTechnicians: vi.fn(),
      mergeRequests: vi.fn(),
      refreshAccessToken: vi.fn(),
      updateRequestSchedule: vi.fn(),
    });

    const response = await POST(
      new Request("https://command.egit.com.au/api/internal/dispatch/live-schedule", {
        body: JSON.stringify({
          date: "2026-07-24",
          end: "11:00",
          requestId: "123",
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
    expect(afterTasks).toHaveLength(0);
    expect(recordDispatchTestSyncEvent).not.toHaveBeenCalled();
  });
});

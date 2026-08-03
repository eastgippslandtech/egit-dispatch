import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { createPostgresAtomicScheduleWriter } from "@/server/integrations/schedule-write";
import { wakeIntegrationProcessor } from "@/server/integrations/wake";

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

vi.mock("@/server/integrations/schedule-write", () => ({
  createPostgresAtomicScheduleWriter: vi.fn(),
}));

vi.mock("@/server/integrations/wake", () => ({
  wakeIntegrationProcessor: vi.fn(),
}));

const getAccessMock = vi.mocked(getCommandCentreAccess);
const createScheduleWriterMock = vi.mocked(createPostgresAtomicScheduleWriter);
const wakeMock = vi.mocked(wakeIntegrationProcessor);
const persist = vi.fn();

describe("live dispatch schedule route", () => {
  beforeEach(() => {
    afterTasks.length = 0;
    vi.clearAllMocks();
    getAccessMock.mockResolvedValue({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
    persist.mockResolvedValue({
      operation: { id: "operation-schedule-1", state: "queued" },
      replayed: false,
    });
    createScheduleWriterMock.mockReturnValue({ persist } as never);
    wakeMock.mockResolvedValue(undefined);
  });

  it("rejects a wallboard-only session", async () => {
    getAccessMock.mockResolvedValueOnce({
      name: "Command Centre Wallboard",
      status: "wallboard-only",
    });

    const response = await POST(requestWith({}));

    expect(response.status).toBe(403);
    expect(persist).not.toHaveBeenCalled();
  });

  it("requires one stable caller idempotency key", async () => {
    const response = await POST(requestWith(validCommand({ idempotencyKey: undefined })));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/idempotency key/i),
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it("persists locally, enqueues provider work, and returns immediately", async () => {
    const response = await POST(requestWith(validCommand()));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      appointmentId: "pending-live-123",
      ok: true,
      operationId: "operation-schedule-1",
      status: "queued",
    });
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        createdBy: "simeon@egit.com.au",
        events: [
          expect.objectContaining({
            appointmentId: "pending-live-123",
            payload: expect.objectContaining({ liveSync: { status: "pending" } }),
            requestId: "123",
            technicianId: "tech-matt",
          }),
        ],
        operation: expect.objectContaining({
          actionType: "dispatch.schedule",
          actorEmail: "simeon@egit.com.au",
          idempotencyKey: "schedule-command-123",
          requestId: "123",
          steps: expect.arrayContaining([
            expect.objectContaining({ stepKey: "msp:schedule" }),
            expect.objectContaining({ stepKey: "outlook:lead:tech-matt" }),
            expect.objectContaining({ stepKey: "command:link" }),
          ]),
        }),
      }),
    );
    expect(wakeMock).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(1);

    await afterTasks[0]!();

    expect(wakeMock).toHaveBeenCalledWith("operation-schedule-1");
  });

  it("replays the same command without creating a second provider operation", async () => {
    persist.mockResolvedValueOnce({
      operation: { id: "operation-existing", state: "syncing" },
      replayed: true,
    });

    const response = await POST(requestWith(validCommand()));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      operationId: "operation-existing",
      status: "syncing",
    });
  });

  it("persists the same rounded window that providers will receive", async () => {
    await POST(
      requestWith(validCommand({ end: "11:07", start: "10:07" })),
    );

    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [expect.objectContaining({ end: "11:15", start: "10:15" })],
      }),
    );
  });

  it("persists lead and two crew with distinct travel context so all survive refresh", async () => {
    await POST(
      requestWith(
        validCommand({
          crew: [
            {
              technicianEmail: "jervy@egit.com.au",
              technicianId: "tech-jervy",
              technicianName: "Jervy",
              travel: travelEstimate("Bairnsdale", 10),
              userPrincipalName: "jervy@egit.com.au",
            },
            {
              technicianEmail: "riley@egit.com.au",
              technicianId: "tech-riley",
              technicianName: "Riley",
              travel: travelEstimate("Bairnsdale", 15),
              userPrincipalName: "riley@egit.com.au",
            },
          ],
          travel: travelEstimate("Sale", 25),
        }),
      ),
    );

    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [
          expect.objectContaining({
            payload: expect.objectContaining({
              scheduleAssignment: {
                assignmentKey: "pending-live-123:tech-matt",
                groupId: "pending-live-123",
                role: "lead",
              },
              travel: expect.objectContaining({ travelToSiteMinutes: 25 }),
              scheduleRoster: {
                assignments: expect.arrayContaining([
                  expect.objectContaining({ technicianId: "tech-matt" }),
                  expect.objectContaining({ technicianId: "tech-jervy" }),
                  expect.objectContaining({ technicianId: "tech-riley" }),
                ]),
                groupId: "pending-live-123",
              },
            }),
            technicianId: "tech-matt",
          }),
          expect.objectContaining({
            appointmentId: "pending-live-123-crew-tech-jervy",
            payload: expect.objectContaining({
              scheduleAssignment: expect.objectContaining({ role: "crew" }),
              travel: expect.objectContaining({ travelToSiteMinutes: 10 }),
            }),
            technicianId: "tech-jervy",
          }),
          expect.objectContaining({
            appointmentId: "pending-live-123-crew-tech-riley",
            payload: expect.objectContaining({
              scheduleAssignment: expect.objectContaining({ role: "crew" }),
              travel: expect.objectContaining({ travelToSiteMinutes: 15 }),
            }),
            technicianId: "tech-riley",
          }),
        ],
        reconciliation: {
          retainedEventIds: [
            "live-schedule-pending-live-123",
            "live-schedule-pending-live-123-crew-tech-jervy",
            "live-schedule-pending-live-123-crew-tech-riley",
          ],
          scheduleGroupId: "pending-live-123",
        },
      }),
    );
    const persistedEvents = vi.mocked(persist).mock.calls[0][0].events;
    expect(persistedEvents).toHaveLength(3);
    for (const event of persistedEvents) {
      expect(event.payload?.scheduleRoster).toEqual({
        assignments: [
          {
            appointmentId: "pending-live-123",
            outlookEventId: undefined,
            technicianId: "tech-matt",
          },
          {
            appointmentId: "pending-live-123-crew-tech-jervy",
            outlookEventId: undefined,
            technicianId: "tech-jervy",
          },
          {
            appointmentId: "pending-live-123-crew-tech-riley",
            outlookEventId: undefined,
            technicianId: "tech-riley",
          },
        ],
        groupId: "pending-live-123",
      });
    }
  });

  it("rejects duplicate lead and crew technicians before local persistence", async () => {
    const response = await POST(
      requestWith(
        validCommand({
          crew: [
            {
              technicianId: "tech-matt",
              technicianName: "Matt",
              userPrincipalName: "mattd@egit.com.au",
            },
          ],
        }),
      ),
    );

    expect(response.status).toBe(400);
    expect(persist).not.toHaveBeenCalled();
  });
});

function validCommand(overrides: Record<string, unknown> = {}) {
  return {
    appointmentId: "pending-live-123",
    bookingType: "Onsite",
    crew: [],
    customer: "Example Co",
    date: "2026-08-04",
    end: "11:00",
    idempotencyKey: "schedule-command-123",
    location: "137 Main Street, Bairnsdale VIC 3875",
    requestId: "123",
    requestNumber: "REQ-123",
    start: "10:00",
    subject: "Printer offline",
    technicianEmail: "mattd@egit.com.au",
    technicianId: "tech-matt",
    technicianMspCentralId: "msp-tech-matt",
    technicianName: "Matt",
    userPrincipalName: "mattd@egit.com.au",
    ...overrides,
  };
}

function travelEstimate(
  officeOriginName: "Bairnsdale" | "Sale",
  minutes: number,
) {
  const officeOriginId = officeOriginName.toLowerCase() as
    | "bairnsdale"
    | "sale";
  return {
    officeOriginAddress:
      officeOriginId === "sale"
        ? "387 Raymond Street, Sale VIC 3850"
        : "137 Main Street, Bairnsdale VIC 3875",
    officeOriginId,
    officeOriginName,
    travelBackToOfficeMinutes: minutes,
    travelCalculatedFrom: "technician_base_office",
    travelCalculationReason: "Estimated from technician base office",
    travelEstimated: false,
    travelMode: "office_to_site_and_back",
    travelToSiteMinutes: minutes,
  };
}

function requestWith(body: unknown) {
  return new Request(
    "https://command.egit.com.au/api/internal/dispatch/live-schedule",
    {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

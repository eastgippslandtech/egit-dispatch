import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { readDispatchConfig } from "@/server/dispatch/env";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { createPostgresAtomicScheduleWriter } from "@/server/integrations/schedule-write";
import { wakeIntegrationProcessor } from "@/server/integrations/wake";
import { createMspCentralClient } from "@/server/msp-central/client";
import { MspCentralConfigurationError } from "@/server/msp-central/errors";

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

vi.mock("@/server/dispatch/env", () => ({
  readDispatchConfig: vi.fn(),
}));

vi.mock("@/server/msp-central/client", () => ({
  createMspCentralClient: vi.fn(),
}));

vi.mock("@/server/integrations/repository", () => ({
  createPostgresIntegrationRepository: vi.fn(),
}));

vi.mock("@/server/integrations/schedule-write", () => ({
  createPostgresAtomicScheduleWriter: vi.fn(),
}));

vi.mock("@/server/integrations/wake", () => ({
  wakeIntegrationProcessor: vi.fn(),
}));

const getAccessMock = vi.mocked(getCommandCentreAccess);
const configMock = vi.mocked(readDispatchConfig);
const createMspClientMock = vi.mocked(createMspCentralClient);
const createRepositoryMock = vi.mocked(createPostgresIntegrationRepository);
const createScheduleWriterMock = vi.mocked(createPostgresAtomicScheduleWriter);
const wakeMock = vi.mocked(wakeIntegrationProcessor);
const persist = vi.fn();
const getRequest = vi.fn();
const findOperationByIdempotencyKey = vi.fn();

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
    configMock.mockReturnValue({ dispatchDataSource: "mock" } as never);
    createMspClientMock.mockReturnValue({ getRequest } as never);
    getRequest.mockResolvedValue({ id: "123", requestNumber: "REQ-123", status: "Open" });
    findOperationByIdempotencyKey.mockResolvedValue(undefined);
    createRepositoryMock.mockReturnValue({ findOperationByIdempotencyKey } as never);
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
              eventId: "event-crew-jervy",
              technicianEmail: "jervy@egit.com.au",
              technicianId: "tech-jervy",
              technicianName: "Jervy",
              travel: travelEstimate("Bairnsdale", 10),
              userPrincipalName: "jervy@egit.com.au",
            },
            {
              eventId: "event-crew-riley",
              technicianEmail: "riley@egit.com.au",
              technicianId: "tech-riley",
              technicianName: "Riley",
              travel: travelEstimate("Bairnsdale", 15),
              userPrincipalName: "riley@egit.com.au",
            },
          ],
          eventId: "event-lead",
          travel: travelEstimate("Sale", 25),
        }),
      ),
    );

    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [
          expect.objectContaining({
            payload: expect.objectContaining({
              liveSync: {
                outlookEventId: "event-lead",
                status: "pending",
              },
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
              liveSync: {
                outlookEventId: "event-crew-jervy",
                status: "pending",
              },
              scheduleAssignment: expect.objectContaining({ role: "crew" }),
              travel: expect.objectContaining({ travelToSiteMinutes: 10 }),
            }),
            technicianId: "tech-jervy",
          }),
          expect.objectContaining({
            appointmentId: "pending-live-123-crew-tech-riley",
            payload: expect.objectContaining({
              liveSync: {
                outlookEventId: "event-crew-riley",
                status: "pending",
              },
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
            outlookEventId: "event-lead",
            role: "lead",
            technicianId: "tech-matt",
          },
          {
            appointmentId: "pending-live-123-crew-tech-jervy",
            outlookEventId: "event-crew-jervy",
            role: "crew",
            technicianId: "tech-jervy",
          },
          {
            appointmentId: "pending-live-123-crew-tech-riley",
            outlookEventId: "event-crew-riley",
            role: "crew",
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

  it("rejects a merged MSP Central request before recording or notifying", async () => {
    configMock.mockReturnValue({ dispatchDataSource: "msp-central" } as never);
    getRequest.mockRejectedValueOnce(new MspCentralConfigurationError(
      "MSP Central API request failed with status 404: Invalid URL accessed.",
      { status: 404 },
    ));

    const response = await POST(requestWith(validCommand({ requestNumber: "24193" })));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/24193.*merged|merged.*24193/i),
    });
    expect(getRequest).toHaveBeenCalledWith("123");
    expect(persist).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(0);
  });

  it("confirms the live request ID before persisting a schedule", async () => {
    configMock.mockReturnValue({ dispatchDataSource: "msp-central" } as never);
    getRequest.mockResolvedValueOnce({ id: "different-id", requestNumber: "REQ-123" });

    const response = await POST(requestWith(validCommand()));

    expect(response.status).toBe(409);
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects a cancelled MSP Central request before recording or notifying", async () => {
    configMock.mockReturnValue({ dispatchDataSource: "msp-central" } as never);
    getRequest.mockResolvedValueOnce({ id: "123", requestNumber: "REQ-123", status: "Cancelled" });

    const response = await POST(requestWith(validCommand()));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/REQ-123.*cancelled/i),
      ok: false,
    });
    expect(persist).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(0);
  });

  it("rejects a resolved or closed MSP Central request before recording", async () => {
    configMock.mockReturnValue({ dispatchDataSource: "msp-central" } as never);
    getRequest.mockResolvedValueOnce({ id: "123", requestNumber: "REQ-123", status: "Resolved" });

    const response = await POST(requestWith(validCommand()));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/resolved or closed/i),
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when MSP Central cannot be read", async () => {
    configMock.mockReturnValue({ dispatchDataSource: "msp-central" } as never);
    getRequest.mockRejectedValueOnce(new MspCentralConfigurationError(
      "MSP Central API request failed with status 502: Bad gateway.",
      { status: 502 },
    ));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await POST(requestWith(validCommand()));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/could not confirm ticket REQ-123.*nothing was scheduled or sent/i),
    });
    expect(persist).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(0);
    warn.mockRestore();
  });

  it("fails closed when the MSP Central read exceeds the preflight timeout", async () => {
    vi.useFakeTimers();
    try {
      configMock.mockReturnValue({ dispatchDataSource: "msp-central" } as never);
      getRequest.mockReturnValueOnce(new Promise(() => undefined));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const pending = POST(requestWith(validCommand()));
      await vi.advanceTimersByTimeAsync(6_000);
      const response = await pending;

      expect(response.status).toBe(503);
      expect(persist).not.toHaveBeenCalled();
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("queues an open live request after confirming it", async () => {
    configMock.mockReturnValue({ dispatchDataSource: "msp-central" } as never);

    const response = await POST(requestWith(validCommand()));

    expect(response.status).toBe(202);
    expect(findOperationByIdempotencyKey).toHaveBeenCalledWith("schedule-command-123");
    expect(getRequest).toHaveBeenCalledWith("123");
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("returns an accepted replay without re-checking a since-merged request", async () => {
    configMock.mockReturnValue({ dispatchDataSource: "msp-central" } as never);
    findOperationByIdempotencyKey.mockResolvedValueOnce({
      id: "operation-schedule-1",
      state: "synced",
    });
    persist.mockResolvedValueOnce({
      operation: { id: "operation-schedule-1", state: "synced" },
      replayed: true,
    });

    const response = await POST(requestWith(validCommand()));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      operationId: "operation-schedule-1",
      status: "synced",
    });
    expect(getRequest).not.toHaveBeenCalled();
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

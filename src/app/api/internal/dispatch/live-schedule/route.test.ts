import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { recordDispatchTestSyncEvent } from "@/server/dispatch/test-sync";
import { wakeIntegrationProcessor } from "@/server/integrations/wake";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";

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

vi.mock("@/server/dispatch/test-sync", () => ({
  recordDispatchTestSyncEvent: vi.fn(),
}));

vi.mock("@/server/integrations/repository", () => ({
  createPostgresIntegrationRepository: vi.fn(),
}));

vi.mock("@/server/integrations/wake", () => ({
  wakeIntegrationProcessor: vi.fn(),
}));

const getAccessMock = vi.mocked(getCommandCentreAccess);
const recordLocalMock = vi.mocked(recordDispatchTestSyncEvent);
const createRepositoryMock = vi.mocked(createPostgresIntegrationRepository);
const wakeMock = vi.mocked(wakeIntegrationProcessor);
const enqueue = vi.fn();

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
    recordLocalMock.mockResolvedValue({} as never);
    enqueue.mockResolvedValue({
      operation: { id: "operation-schedule-1", state: "queued" },
      replayed: false,
    });
    createRepositoryMock.mockReturnValue({ enqueue } as never);
    wakeMock.mockResolvedValue(undefined);
  });

  it("rejects a wallboard-only session", async () => {
    getAccessMock.mockResolvedValueOnce({
      name: "Command Centre Wallboard",
      status: "wallboard-only",
    });

    const response = await POST(requestWith({}));

    expect(response.status).toBe(403);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("requires one stable caller idempotency key", async () => {
    const response = await POST(requestWith(validCommand({ idempotencyKey: undefined })));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/idempotency key/i),
    });
    expect(recordLocalMock).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
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
    expect(recordLocalMock).toHaveBeenCalledBefore(enqueue);
    expect(recordLocalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: "pending-live-123",
        payload: expect.objectContaining({
          liveSync: { status: "pending" },
        }),
        requestId: "123",
      }),
      "simeon@egit.com.au",
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
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
    );
    expect(wakeMock).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(1);

    await afterTasks[0]!();

    expect(wakeMock).toHaveBeenCalledWith("operation-schedule-1");
  });

  it("replays the same command without creating a second provider operation", async () => {
    enqueue.mockResolvedValueOnce({
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

    expect(recordLocalMock).toHaveBeenCalledWith(
      expect.objectContaining({ end: "11:15", start: "10:15" }),
      "simeon@egit.com.au",
    );
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
    expect(recordLocalMock).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
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

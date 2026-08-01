import { describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import {
  clearDispatchTestSyncEvents,
  listDispatchTestSyncEvents,
  recordDispatchTestSyncEvent,
} from "@/server/dispatch/test-sync";
import { DELETE, GET, POST } from "./route";

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

vi.mock("@/server/dispatch/test-sync", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/dispatch/test-sync")>();

  return {
    ...actual,
    clearDispatchTestSyncEvents: vi.fn(),
    listDispatchTestSyncEvents: vi.fn(),
    recordDispatchTestSyncEvent: vi.fn(),
  };
});

const getCommandCentreAccessMock = vi.mocked(getCommandCentreAccess);
const clearDispatchTestSyncEventsMock = vi.mocked(clearDispatchTestSyncEvents);
const listDispatchTestSyncEventsMock = vi.mocked(listDispatchTestSyncEvents);
const recordDispatchTestSyncEventMock = vi.mocked(recordDispatchTestSyncEvent);

describe("dispatch test sync event API", () => {
  it("requires an approved Command Centre user", async () => {
    getCommandCentreAccessMock.mockResolvedValueOnce({
      status: "unauthenticated",
    });

    const response = await POST(
      new Request("https://command.egit.com.au/api/internal/dispatch/test-sync/events", {
        body: "{}",
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
  });

  it("rejects a wallboard-only session", async () => {
    getCommandCentreAccessMock.mockResolvedValueOnce({
      name: "Command Centre Wallboard",
      status: "wallboard-only",
    });

    const response = await POST(
      new Request("https://command.egit.com.au/api/internal/dispatch/test-sync/events", {
        body: "{}",
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
  });

  it("records dispatcher schedule events", async () => {
    getCommandCentreAccessMock.mockResolvedValueOnce({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      status: "approved",
    });
    recordDispatchTestSyncEventMock.mockResolvedValueOnce({
      id: "test-sync-1",
      eventType: "scheduled",
      requestId: "req-1",
      appointmentId: "appt-1",
      technicianId: "matt",
      date: "2026-07-08",
      start: "09:30",
      end: "10:30",
      createdAt: "2026-07-08T00:00:00.000Z",
      createdBy: "simeon@egit.com.au",
    });

    const response = await POST(
      new Request("https://command.egit.com.au/api/internal/dispatch/test-sync/events", {
        body: JSON.stringify({
          eventType: "scheduled",
          requestId: "req-1",
          appointmentId: "appt-1",
          technicianId: "matt",
          date: "2026-07-08",
          start: "09:30",
          end: "10:30",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      event: {
        eventType: "scheduled",
        requestId: "req-1",
      },
      ok: true,
    });
    expect(recordDispatchTestSyncEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "scheduled",
        requestId: "req-1",
      }),
      "simeon@egit.com.au",
    );
  });

  it("lists current test sync events for debugging", async () => {
    getCommandCentreAccessMock.mockResolvedValueOnce({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      status: "approved",
    });
    listDispatchTestSyncEventsMock.mockResolvedValueOnce([]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ events: [], ok: true });
  });

  it("clears test sync events", async () => {
    getCommandCentreAccessMock.mockResolvedValueOnce({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      status: "approved",
    });
    clearDispatchTestSyncEventsMock.mockResolvedValueOnce(undefined);

    const response = await DELETE();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(clearDispatchTestSyncEventsMock).toHaveBeenCalledWith();
  });
});

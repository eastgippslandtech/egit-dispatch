import { describe, expect, it, vi } from "vitest";

import type { WorklogDispositionCommand } from "./disposition";
import { createWorklogDispositionRuntime } from "./runtime";

const base: WorklogDispositionCommand = {
  currentBooking: {
    eventId: "event-1",
    technicianId: "tech-jervy",
    userPrincipalName: "jervy@egit.com.au",
  },
  description: "Work completed.",
  disposition: "return_to_queue",
  durationMinutes: 30,
  endedAt: "2026-08-03T01:00:00.000Z",
  idempotencyKey: "operation-1",
  requestId: "request-1",
  scheduled: true,
  startedAt: "2026-08-03T00:30:00.000Z",
};

describe("Work Log disposition runtime", () => {
  it("returns a scheduled request to the queue and removes its calendar booking", async () => {
    const dependencies = createDependencies();
    const runtime = createWorklogDispositionRuntime(dependencies);

    await runtime.applyDisposition(base);

    expect(dependencies.mspClient.clearRequestSchedule).toHaveBeenCalledWith({
      requestId: "request-1",
    });
    expect(dependencies.graphClient.deleteEvent).toHaveBeenCalledWith({
      eventId: "event-1",
      userPrincipalName: "jervy@egit.com.au",
    });
    expect(dependencies.outcomeStore.clearSchedule).toHaveBeenCalledWith({
      requestId: "request-1",
      status: "sdp_only",
    });
  });

  it("books forward with one replacement Outlook event and schedule", async () => {
    const dependencies = createDependencies();
    const runtime = createWorklogDispositionRuntime(dependencies);
    const command: WorklogDispositionCommand = {
      ...base,
      disposition: "book_forward",
      booking: {
        bookingType: "Onsite",
        customer: "OneHarvest",
        date: "2026-08-04",
        end: "11:15",
        eventId: "event-1",
        location: "Bairnsdale VIC 3875",
        requestNumber: "REQ-100284",
        start: "10:00",
        subject: "Printer offline",
        technicianEmail: "mattd@egit.com.au",
        technicianId: "tech-matt",
        technicianName: "Matt",
        userPrincipalName: "mattd@egit.com.au",
      },
    };

    await runtime.applyDisposition(command);

    expect(dependencies.mspClient.updateRequestSchedule).toHaveBeenCalledOnce();
    expect(dependencies.graphClient.deleteEvent).toHaveBeenCalledOnce();
    expect(dependencies.graphClient.createEvent).toHaveBeenCalledOnce();
    expect(dependencies.outcomeStore.bookForward).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "event-2", requestId: "request-1" }),
    );
  });

  it("transfers ownership, clears the booking, and records the reason", async () => {
    const dependencies = createDependencies();
    const runtime = createWorklogDispositionRuntime(dependencies);

    await runtime.applyDisposition({
      ...base,
      disposition: "transfer_escalate",
      transfer: {
        reason: "Requires senior network review",
        targetEmail: "simeon@egit.com.au",
        targetTechnicianId: "tech-simeon",
        targetTechnicianName: "Simeon",
      },
    });

    expect(dependencies.mspClient.assignRequest).toHaveBeenCalledWith({
      requestId: "request-1",
      technicianName: "Simeon",
    });
    expect(dependencies.outcomeStore.transfer).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "Requires senior network review" }),
    );
  });
});

function createDependencies() {
  return {
    graphClient: {
      createEvent: vi.fn().mockResolvedValue({ id: "event-2" }),
      deleteEvent: vi.fn(),
      updateEvent: vi.fn().mockResolvedValue({ id: "event-1" }),
    },
    mspClient: {
      addRequestWorklog: vi.fn(),
      assignRequest: vi.fn(),
      clearRequestSchedule: vi.fn(),
      updateRequestSchedule: vi.fn(),
      updateRequestStatus: vi.fn(),
    },
    outcomeStore: {
      bookForward: vi.fn(),
      clearSchedule: vi.fn(),
      transfer: vi.fn(),
    },
  };
}

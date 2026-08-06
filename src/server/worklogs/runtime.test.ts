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
  visibility: "external",
  workType: "billable",
};

describe("Work Log disposition runtime", () => {
  it("returns a scheduled request to the queue and removes its calendar booking", async () => {
    const dependencies = createDependencies();
    const runtime = createWorklogDispositionRuntime(dependencies);

    await runtime.applyDisposition(base);

    expect(dependencies.mspClient.updateRequestStatus).toHaveBeenCalledWith({
      requestId: "request-1",
      status: "Open",
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

  it("removes every lead and crew calendar booking when a request leaves the schedule", async () => {
    const dependencies = createDependencies();
    dependencies.outcomeStore.listCalendarAssignments.mockResolvedValue([
      {
        eventId: "event-lead",
        userPrincipalName: "mattd@egit.com.au",
      },
      {
        eventId: "event-crew",
        userPrincipalName: "jervy@egit.com.au",
      },
    ]);
    const runtime = createWorklogDispositionRuntime(dependencies);

    await runtime.applyDisposition({
      ...base,
      currentBooking: {
        ...base.currentBooking!,
        eventId: "event-crew",
      },
      disposition: "complete",
    });

    expect(dependencies.graphClient.deleteEvent).toHaveBeenCalledTimes(2);
    expect(dependencies.graphClient.deleteEvent).toHaveBeenCalledWith({
      eventId: "event-lead",
      userPrincipalName: "mattd@egit.com.au",
    });
    expect(dependencies.graphClient.deleteEvent).toHaveBeenCalledWith({
      eventId: "event-crew",
      userPrincipalName: "jervy@egit.com.au",
    });
  });

  it("saves a typed Work Log with its mandatory MSP owner", async () => {
    const dependencies = createDependencies();
    const runtime = createWorklogDispositionRuntime(dependencies);

    await runtime.saveWorklog(base);

    expect(dependencies.mspClient.addRequestWorklog).toHaveBeenCalledWith({
      description: "Work completed.",
      durationMinutes: 30,
      endedAt: "2026-08-03T01:00:00.000Z",
      ownerId: "msp-tech-jervy",
      requestId: "request-1",
      startedAt: "2026-08-03T00:30:00.000Z",
      worklogType: "billable",
    });
  });

  it("completes a request by resolving it without writing unavailable schedule fields", async () => {
    const dependencies = createDependencies();
    const runtime = createWorklogDispositionRuntime(dependencies);

    await runtime.applyDisposition({ ...base, disposition: "complete" });

    expect(dependencies.mspClient.updateRequestStatus).toHaveBeenCalledWith({
      requestId: "request-1",
      status: "Resolved",
    });
    expect(dependencies.mspClient.clearRequestSchedule).not.toHaveBeenCalled();
    expect(dependencies.outcomeStore.clearSchedule).toHaveBeenCalledWith({
      requestId: "request-1",
      status: "sdp_only",
    });
  });

  it("publishes an approved completion solution to the request and customer conversation", async () => {
    const dependencies = createDependencies();
    const runtime = createWorklogDispositionRuntime(dependencies);

    await runtime.applyDisposition({
      ...base,
      disposition: "complete",
      solution: "Replaced the failed switch and confirmed labels print normally.",
    });

    expect(dependencies.mspClient.setRequestResolution).toHaveBeenCalledWith({
      content: "Replaced the failed switch and confirmed labels print normally.",
      requestId: "request-1",
    });
    expect(dependencies.mspClient.addRequestNote).toHaveBeenCalledWith({
      description: "Replaced the failed switch and confirmed labels print normally.",
      requestId: "request-1",
      visibility: "customer",
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
    expect(dependencies.graphClient.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Printer offline" }),
    );
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
      technicianEmail: "simeon@egit.com.au",
      technicianName: "Simeon",
    });
    expect(dependencies.mspClient.updateRequestStatus).toHaveBeenCalledWith({
      requestId: "request-1",
      status: "Open",
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
      addRequestNote: vi.fn(),
      addRequestWorklog: vi.fn(),
      assignRequest: vi.fn(),
      clearRequestSchedule: vi.fn(),
      setRequestResolution: vi.fn(),
      updateRequestSchedule: vi.fn(),
      updateRequestStatus: vi.fn(),
    },
    outcomeStore: {
      bookForward: vi.fn(),
      clearSchedule: vi.fn(),
      listCalendarAssignments: vi.fn().mockResolvedValue([]),
      transfer: vi.fn(),
    },
    worklogOwner: {
      id: "msp-tech-jervy",
    },
  };
}

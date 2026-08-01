import { describe, expect, it } from "vitest";

import { validateWorklogDispositionCommand } from "./disposition";

const baseCommand = {
  description: "Replaced the failed switch and tested connectivity.",
  durationMinutes: 45,
  endedAt: "2026-08-03T01:00:00.000Z",
  idempotencyKey: "worklog-request-1-20260803",
  requestId: "request-1",
  scheduled: true,
  startedAt: "2026-08-03T00:15:00.000Z",
};

describe("worklog disposition validation", () => {
  it("rejects a scheduled Work Log without an outcome", () => {
    expect(() => validateWorklogDispositionCommand(baseCommand)).toThrow(
      "Choose what happens to this scheduled job",
    );
  });

  it("allows an unscheduled Work Log without another outcome", () => {
    expect(
      validateWorklogDispositionCommand({ ...baseCommand, scheduled: false }),
    ).toMatchObject({ disposition: undefined, scheduled: false });
  });

  it("requires complete Book Forward scheduling details", () => {
    expect(() =>
      validateWorklogDispositionCommand({
        ...baseCommand,
        disposition: "book_forward",
      }),
    ).toThrow("Book Forward requires");

    expect(
      validateWorklogDispositionCommand({
        ...baseCommand,
        disposition: "book_forward",
        booking: {
          bookingType: "Onsite",
          customer: "OneHarvest",
          date: "2026-08-04",
          end: "11:15",
          location: "Bairnsdale VIC 3875",
          requestNumber: "REQ-100284",
          start: "10:00",
          subject: "Packhouse label printer offline",
          technicianEmail: "jervy@egit.com.au",
          technicianId: "tech-jervy",
          technicianName: "Jervy",
          userPrincipalName: "jervy@egit.com.au",
        },
      }).booking,
    ).toMatchObject({ end: "11:15", technicianId: "tech-jervy" });
  });

  it("requires a Transfer target and reason", () => {
    expect(() =>
      validateWorklogDispositionCommand({
        ...baseCommand,
        disposition: "transfer_escalate",
        transfer: { reason: "", targetTechnicianId: "tech-matt" },
      }),
    ).toThrow("Transfer / escalate requires");
  });
});

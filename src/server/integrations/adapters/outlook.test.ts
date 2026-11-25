import { describe, expect, it, vi } from "vitest";

import type { IntegrationOperationStep } from "../types";
import { createOutlookAdapters } from "./outlook";

describe("Outlook integration adapters", () => {
  it("refuses to overwrite a different ticket's calendar event even when their supplier reference matches", async () => {
    const updateEvent = vi.fn();
    const getEvent = vi.fn().mockResolvedValue({
      id: "event-old", subject: "Technician Work Order: 707010883 - old incident",
      bodyPreview: "Command-Centre-Booking: old-booking\nRequest: 24458",
    });
    const adapters = createOutlookAdapters({ graphClient: graphClient({ getEvent, updateEvent }) });
    await expect(adapters["outlook.upsert_event"].execute(step("outlook.upsert_event", {
      appointmentId: "new-booking", requestId: "6768000002950168", requestNumber: "24626", eventId: "event-old",
      start: "2026-11-26T10:30:00", end: "2026-11-26T12:45:00",
      subject: "Technician Work Order: 707010883 - new incident", userPrincipalName: "jervy@egit.com.au",
    }))).rejects.toThrow(/another ticket/i);
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it("updates a matching event by its Request metadata rather than its supplier title", async () => {
    const updateEvent = vi.fn().mockResolvedValue({ id: "event-matching" });
    const getEvent = vi.fn().mockResolvedValue({
      id: "event-matching", subject: "Technician Work Order: 707010883",
      bodyPreview: "Command-Centre-Booking: group-id\nRequest: 24626",
    });
    const adapters = createOutlookAdapters({ graphClient: graphClient({ getEvent, updateEvent }) });
    await adapters["outlook.upsert_event"].execute(step("outlook.upsert_event", {
      appointmentId: "new-booking", requestId: "6768000002950168", requestNumber: "24626", eventId: "event-matching",
      start: "2026-11-26T10:30:00", end: "2026-11-26T12:45:00",
      subject: "Technician Work Order: 707010883", userPrincipalName: "jervy@egit.com.au",
    }));
    expect(getEvent).toHaveBeenCalledOnce();
    expect(updateEvent).toHaveBeenCalledOnce();
  });
  it("creates with a stable Graph transaction ID and returns booking identity", async () => {
    const createEvent = vi.fn().mockResolvedValue({
      id: "event-42",
      webLink: "https://outlook.office.com/event-42",
    });
    const adapters = createOutlookAdapters({
      graphClient: graphClient({ createEvent }),
    });

    const result = await adapters["outlook.upsert_event"].execute(
      step("outlook.upsert_event", {
        appointmentId: "appointment-42",
        bodyPreview: "Command-Centre-Booking: appointment-42\nRequest: REQ-42",
        end: "2026-08-04T11:00:00",
        requestNumber: "REQ-42",
        start: "2026-08-04T10:00:00",
        subject: "REQ-42 Printer offline",
        technicianId: "tech-simeon",
        transactionId: "schedule:request-42:v1:outlook:tech-simeon",
        userPrincipalName: "simeon@egit.com.au",
      }),
    );

    expect(adapters["outlook.upsert_event"].writeSafety).toBe("idempotent");
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Printer offline",
        transactionId: "schedule:request-42:v1:outlook:tech-simeon",
      }),
    );
    expect(result).toEqual({
      bookingIdentity: "appointment-42",
      commandCreated: true,
      externalId: "event-42",
      webLink: "https://outlook.office.com/event-42",
    });
  });

  it("updates only the stored event ID and never creates a replacement", async () => {
    const createEvent = vi.fn();
    const updateEvent = vi.fn().mockResolvedValue({ id: "event-existing" });
    const adapters = createOutlookAdapters({
      graphClient: graphClient({ createEvent, updateEvent }),
    });

    await adapters["outlook.upsert_event"].execute(
      step("outlook.upsert_event", {
        appointmentId: "appointment-42",
        end: "2026-08-04T12:00:00",
        eventId: "event-existing",
        start: "2026-08-04T11:00:00",
        subject: "Printer offline",
        transactionId: "ignored-on-update",
        userPrincipalName: "simeon@egit.com.au",
      }),
    );

    expect(updateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "event-existing",
        transactionId: undefined,
      }),
    );
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("deletes obsolete stored events idempotently", async () => {
    const deleteEvent = vi.fn().mockResolvedValue(undefined);
    const adapters = createOutlookAdapters({
      graphClient: graphClient({ deleteEvent }),
    });

    await adapters["outlook.delete_event"].execute(
      step("outlook.delete_event", {
        eventId: "obsolete-event",
        userPrincipalName: "mattd@egit.com.au",
      }),
    );

    expect(adapters["outlook.delete_event"].writeSafety).toBe("idempotent");
    expect(deleteEvent).toHaveBeenCalledWith({
      eventId: "obsolete-event",
      userPrincipalName: "mattd@egit.com.au",
    });
  });
});

function graphClient(overrides: Record<string, unknown> = {}) {
  return {
    createEvent: vi.fn(),
    deleteEvent: vi.fn(),
    updateEvent: vi.fn(),
    ...overrides,
  } as never;
}

function step(action: string, payload: Record<string, unknown>): IntegrationOperationStep {
  return {
    action,
    attemptCount: 1,
    connector: "outlook",
    createdAt: "2026-08-04T00:00:00.000Z",
    id: `step-${action}`,
    leaseToken: "lease-1",
    operationId: "operation-1",
    payload,
    requiresReconciliation: false,
    state: "processing",
    stepKey: action,
    stepOrder: 0,
    updatedAt: "2026-08-04T00:00:00.000Z",
  };
}

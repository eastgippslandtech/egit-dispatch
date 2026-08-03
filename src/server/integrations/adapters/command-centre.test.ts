import { describe, expect, it, vi } from "vitest";

import type { IntegrationOperationStep } from "../types";
import { createCommandCentreAdapters } from "./command-centre";

describe("Command Centre integration adapters", () => {
  it("persists lead and crew provider IDs after all Outlook steps", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const adapters = createCommandCentreAdapters({
      dispatchLinkStore: { save },
      resultReader: {
        async getStepResults() {
          return {
            "outlook:crew:tech-jervy": { externalId: "event-jervy" },
            "outlook:lead:tech-simeon": {
              externalId: "event-simeon",
              webLink: "https://outlook/event-simeon",
            },
          };
        },
      },
    });

    await adapters["command_centre.persist_dispatch_link"].execute(
      step("command_centre.persist_dispatch_link", {
        appointmentId: "appointment-42",
        bookingType: "Onsite",
        crew: [
          {
            technicianEmail: "jervy@egit.com.au",
            technicianId: "tech-jervy",
            userPrincipalName: "jervy@egit.com.au",
          },
        ],
        customer: "Example Co",
        lead: {
          mspCentralTechnicianId: "msp-simeon",
          technicianEmail: "simeon@egit.com.au",
          technicianId: "tech-simeon",
          userPrincipalName: "simeon@egit.com.au",
        },
        location: "123 Main Street, Bairnsdale VIC 3875",
        outlookStepKeys: {
          crew: ["outlook:crew:tech-jervy"],
          lead: "outlook:lead:tech-simeon",
        },
        requestId: "request-42",
        requestNumber: "REQ-42",
        scheduledEnd: "2026-08-04T11:00:00+10:00",
        scheduledStart: "2026-08-04T10:00:00+10:00",
        subject: "Printer offline",
      }),
    );

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        crew: [
          expect.objectContaining({
            outlookEventId: "event-jervy",
            technicianId: "tech-jervy",
          }),
        ],
        outlookEventId: "event-simeon",
        requestId: "request-42",
        syncStatus: "linked",
        technicianId: "tech-simeon",
      }),
    );
  });

  it("invalidates every related request without exposing provider payloads", async () => {
    const invalidate = vi.fn().mockResolvedValue(undefined);
    const adapters = createCommandCentreAdapters({ invalidate });

    await adapters["command_centre.invalidate_request"].execute(
      step("command_centre.invalidate_request", {
        relatedRequestIds: ["duplicate-42", "parent-7"],
        requestId: "duplicate-42",
      }),
    );

    expect(invalidate).toHaveBeenCalledWith([
      "duplicate-42",
      "parent-7",
    ]);
  });
});

function step(action: string, payload: Record<string, unknown>): IntegrationOperationStep {
  return {
    action,
    attemptCount: 1,
    connector: "command_centre",
    createdAt: "2026-08-04T00:00:00.000Z",
    id: `step-${action}`,
    leaseToken: "lease-1",
    operationId: "operation-1",
    payload,
    requiresReconciliation: false,
    state: "processing",
    stepKey: action,
    stepOrder: 5,
    updatedAt: "2026-08-04T00:00:00.000Z",
  };
}

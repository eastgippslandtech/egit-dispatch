import { describe, expect, it } from "vitest";

import {
  communicationOperation,
  createRequestOperation,
  mergeOperation,
  scheduleOperation,
  worklogOperation,
} from "./operations";

const lead = {
  eventId: "event-lead",
  mspCentralTechnicianId: "msp-simeon",
  technicianEmail: "simeon@egit.com.au",
  technicianId: "tech-simeon",
  technicianName: "Simeon",
  userPrincipalName: "simeon@egit.com.au",
};

describe("integration operation builders", () => {
  it("builds a deterministic multi-tech schedule in provider-safe order", () => {
    const input = {
      actorEmail: "dispatcher@egit.com.au",
      appointmentId: "appointment-42",
      bookingType: "Onsite" as const,
      crew: [
        {
          technicianEmail: "riley@egit.com.au",
          technicianId: "tech-riley",
          technicianName: "Riley",
          userPrincipalName: "riley@egit.com.au",
        },
        {
          eventId: "event-jervy",
          technicianEmail: "jervy@egit.com.au",
          technicianId: "tech-jervy",
          technicianName: "Jervy",
          userPrincipalName: "jervy@egit.com.au",
        },
      ],
      customer: "Example Co",
      date: "2026-08-04",
      end: "11:15",
      idempotencyKey: "schedule:request-42:v3",
      lead,
      location: "123 Main Street, Bairnsdale VIC 3875",
      previousAssignments: [
        {
          eventId: "obsolete-matt-event",
          technicianId: "tech-matt",
          userPrincipalName: "mattd@egit.com.au",
        },
        {
          eventId: "event-jervy",
          technicianId: "tech-jervy",
          userPrincipalName: "jervy@egit.com.au",
        },
      ],
      requestId: "request-42",
      requestNumber: "REQ-42",
      start: "10:00",
      subject: "Printer offline",
    };

    const first = scheduleOperation(input);
    const reordered = scheduleOperation({
      ...input,
      crew: [...input.crew].reverse(),
      previousAssignments: [...input.previousAssignments].reverse(),
    });

    expect(first).toEqual(reordered);
    expect(first.steps.map((step) => step.stepKey)).toEqual([
      "msp:schedule",
      "outlook:lead:tech-simeon",
      "outlook:crew:tech-jervy",
      "outlook:crew:tech-riley",
      "outlook:cleanup:tech-matt",
      "command:link",
      "command:refresh",
    ]);
    expect(first.steps[0]).toMatchObject({
      action: "msp.schedule_request",
      connector: "msp_central",
      payload: {
        requestId: "request-42",
        technicianId: "msp-simeon",
      },
    });
    expect(first.steps[3]).toMatchObject({
      action: "outlook.upsert_event",
      payload: {
        transactionId: "schedule:request-42:v3:outlook:tech-riley",
      },
    });
    expect(first.steps[5]).toMatchObject({
      action: "command_centre.persist_dispatch_link",
      payload: {
        outlookStepKeys: {
          crew: [
            "outlook:crew:tech-jervy",
            "outlook:crew:tech-riley",
          ],
          lead: "outlook:lead:tech-simeon",
        },
      },
    });
  });

  it("keeps the Work Log before every disposition write and rounds time up", () => {
    const operation = worklogOperation({
      actorEmail: "simeon@egit.com.au",
      command: {
        description: "Replaced the failed power supply.",
        disposition: "complete",
        durationMinutes: 16,
        endedAt: "2026-08-04T10:16:00+10:00",
        idempotencyKey: "worklog:request-42:timer-9",
        requestId: "request-42",
        scheduled: true,
        solution: "Replaced the failed power supply and tested printing.",
        startedAt: "2026-08-04T10:00:00+10:00",
        visibility: "external",
        workType: "billable",
      },
      ownerId: "msp-simeon",
    });

    expect(operation.steps.map((step) => step.stepKey)).toEqual([
      "msp:worklog",
      "msp:solution",
      "msp:solution-message",
      "msp:status:resolved",
      "command:clear-schedule",
      "command:refresh",
    ]);
    expect(operation.steps[0]).toMatchObject({
      action: "msp.add_worklog",
      payload: { durationMinutes: 30 },
    });
  });

  it.each([
    ["customer", true],
    ["internal", false],
  ] as const)("maps %s Comms visibility explicitly", (visibility, showToRequester) => {
    const operation = communicationOperation({
      actorEmail: "jervy@egit.com.au",
      body: "The replacement has arrived.",
      idempotencyKey: `comms:request-42:${visibility}:1`,
      occurredAt: "2026-08-04T10:00:00+10:00",
      requestId: "request-42",
      visibility,
    });

    expect(operation.steps[0]).toMatchObject({
      action: "msp.add_note",
      payload: { showToRequester, visibility },
      stepKey: "msp:communication",
    });
    expect(operation.steps.at(-1)?.stepKey).toBe("command:refresh");
  });

  it("builds an irreversible child-to-parent merge with a stable key", () => {
    const operation = mergeOperation({
      actorEmail: "dispatcher@egit.com.au",
      childRequestId: "duplicate-42",
      idempotencyKey: "merge:duplicate-42:parent-7",
      parentRequestId: "parent-7",
    });

    expect(operation.requestId).toBe("duplicate-42");
    expect(operation.steps).toEqual([
      {
        action: "msp.merge_requests",
        connector: "msp_central",
        payload: {
          childRequestId: "duplicate-42",
          parentRequestId: "parent-7",
        },
        stepKey: "msp:merge",
      },
      {
        action: "command_centre.invalidate_request",
        connector: "command_centre",
        payload: {
          relatedRequestIds: ["duplicate-42", "parent-7"],
          requestId: "duplicate-42",
        },
        stepKey: "command:refresh",
      },
    ]);
  });

  it("builds a deterministic request creation with a reconciliation fingerprint", () => {
    const input = {
      actorEmail: "simeon@egit.com.au",
      customer: "Example Co",
      description: "Printer cannot reach the network.",
      idempotencyKey: "create-request:mobile:42",
      priority: "High" as const,
      requesterEmail: "user@example.com",
      site: "Bairnsdale office",
      subject: "Printer offline",
    };
    const first = createRequestOperation(input);
    const second = createRequestOperation({ ...input });

    expect(first).toEqual(second);
    expect(first.steps.map((step) => step.stepKey)).toEqual([
      "msp:create-request",
      "command:refresh",
    ]);
    expect(first.steps[0]).toMatchObject({
      action: "msp.create_request",
      payload: {
        commandFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(first.requestId).toMatch(/^pending:/);
  });
});

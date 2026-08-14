import { describe, expect, it } from "vitest";

import {
  communicationOperation,
  createRequestOperation,
  cancelledScheduleCleanupOperation,
  mergeOperation,
  orphanedOutlookCleanupOperation,
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
      "push:assignment:tech-simeon",
      "push:assignment:tech-jervy",
      "push:assignment:tech-riley",
      "email:assignment:tech-simeon",
      "email:assignment:tech-jervy",
      "email:assignment:tech-riley",
      "msp:schedule",
      "outlook:lead:tech-simeon",
      "outlook:crew:tech-jervy",
      "outlook:crew:tech-riley",
      "outlook:cleanup:tech-matt",
      "command:link",
      "command:refresh",
    ]);
    expect(first.steps[0]).toMatchObject({
      action: "push.notify",
      connector: "push",
      payload: {
        body: "REQ-42: Printer offline",
        eventType: "assignment",
        requestId: "request-42",
        requestNumber: "REQ-42",
        technicianId: "tech-simeon",
        title: "Ticket assigned",
      },
    });
    expect(stepPayload(first, "email:assignment:tech-simeon")).toMatchObject({
      bookingType: "Onsite",
      customer: "Example Co",
      eventKey: "schedule:request-42:v3:email:assignment:tech-simeon",
      helpdeskUrl: "https://command.egit.com.au/tickets/REQ-42",
      requestId: "request-42",
      requestNumber: "REQ-42",
      scheduledDate: "2026-08-04",
      scheduledEnd: "11:15",
      scheduledStart: "10:00",
      site: "123 Main Street, Bairnsdale VIC 3875",
      subject: "Printer offline",
      technicianName: "Simeon",
      toEmail: "simeon@egit.com.au",
    });
    expect(stepPayload(first, "email:assignment:tech-simeon").plainText).toContain(
      "Printer offline",
    );
    expect(first.steps[6]).toMatchObject({
      action: "msp.schedule_request",
      connector: "msp_central",
      payload: {
        requestId: "request-42",
        technicianId: "msp-simeon",
      },
    });
    expect(first.steps[9]).toMatchObject({
      action: "outlook.upsert_event",
      payload: {
        transactionId: "schedule:request-42:v3:outlook:tech-riley",
      },
    });
    expect(stepPayload(first, "outlook:cleanup:tech-matt")).toEqual({
      eventId: "obsolete-matt-event",
      technicianId: "tech-matt",
      userPrincipalName: "mattd@egit.com.au",
    });
    expect(first.steps[11]).toMatchObject({
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

  it("does not queue a phone notification when a technician schedules their own job", () => {
    const operation = scheduleOperation({
      actorEmail: "simeon@egit.com.au",
      appointmentId: "appointment-self",
      date: "2026-08-04",
      end: "11:00",
      idempotencyKey: "schedule:self",
      lead,
      requestId: "request-self",
      requestNumber: "REQ-SELF",
      start: "10:00",
      subject: "Self scheduled job",
    });

    expect(operation.steps.map((step) => step.stepKey)).not.toContain(
      "push:assignment:tech-simeon",
    );
    expect(operation.steps.map((step) => step.stepKey)).toContain(
      "email:assignment:tech-simeon",
    );
    expect(operation.steps[0]?.stepKey).toBe("email:assignment:tech-simeon");
  });

  it("includes request context and Helpdesk link in technician schedule emails", () => {
    const operation = scheduleOperation({
      actorEmail: "dispatcher@egit.com.au",
      appointmentId: "appointment-context",
      customer: "RSS Australia Pty Ltd",
      date: "2026-08-11",
      description: "RSS job 101091 needs printer setup before morning classes.",
      end: "14:30",
      helpdeskUrl: "https://mspcentral.example/request/22240",
      idempotencyKey: "schedule:context",
      latestUpdate:
        "Customer replied: Please use the service desk entry near admin.",
      lead,
      location: "Sale College",
      requestId: "67680000022240",
      requestNumber: "22240",
      start: "14:00",
      subject: "RSS JOB 101091, RSS, SALE COLLEGE - SALE",
    });

    const payload = stepPayload(operation, "email:assignment:tech-simeon");
    expect(payload.plainText).toContain("RSS job 101091 needs printer setup");
    expect(payload.plainText).toContain(
      "Customer replied: Please use the service desk entry near admin.",
    );
    expect(payload.plainText).toContain(
      "https://mspcentral.example/request/22240",
    );
    expect(payload.html).toContain("RSS job 101091 needs printer setup");
    expect(payload.html).toContain("https://mspcentral.example/request/22240");
  });

  it("reuses technician event IDs from previous assignments during reschedule", () => {
    const operation = scheduleOperation({
      actorEmail: "dispatcher@egit.com.au",
      appointmentId: "appointment-42",
      crew: [
        {
          technicianId: "tech-jervy",
          userPrincipalName: "jervy@egit.com.au",
        },
      ],
      date: "2026-08-04",
      end: "11:00",
      idempotencyKey: "schedule:request-42:v4",
      lead: { ...lead, eventId: undefined },
      previousAssignments: [
        {
          eventId: "existing-simeon-event",
          technicianId: "tech-simeon",
          userPrincipalName: "simeon@egit.com.au",
        },
        {
          eventId: "existing-jervy-event",
          technicianId: "tech-jervy",
          userPrincipalName: "jervy@egit.com.au",
        },
      ],
      requestId: "request-42",
      requestNumber: "REQ-42",
      start: "10:00",
      subject: "Printer offline",
    });

    expect(stepPayload(operation, "outlook:lead:tech-simeon").eventId).toBe(
      "existing-simeon-event",
    );
    expect(stepPayload(operation, "outlook:crew:tech-jervy").eventId).toBe(
      "existing-jervy-event",
    );
  });

  it.each([
    ["2026-04-04", "+11:00"],
    ["2026-04-05", "+10:00"],
    ["2026-10-03", "+10:00"],
    ["2026-10-04", "+11:00"],
  ])("uses the real Melbourne offset on %s", (date, offset) => {
    const operation = scheduleOperation({
      actorEmail: "dispatcher@egit.com.au",
      appointmentId: `appointment-${date}`,
      date,
      end: "11:07",
      idempotencyKey: `schedule:${date}`,
      lead,
      requestId: `request-${date}`,
      requestNumber: `REQ-${date}`,
      start: "10:07",
      subject: "DST-safe booking",
    });

    expect(stepPayload(operation, "msp:schedule")).toMatchObject({
      scheduledEnd: `${date}T11:15:00${offset}`,
      scheduledStart: `${date}T10:15:00${offset}`,
    });
    expect(stepPayload(operation, "outlook:lead:tech-simeon")).toMatchObject({
      end: `${date}T11:15:00`,
      start: `${date}T10:15:00`,
    });
  });

  it("rounds a schedule across midnight without producing a zero duration", () => {
    const operation = scheduleOperation({
      actorEmail: "dispatcher@egit.com.au",
      appointmentId: "appointment-midnight",
      date: "2026-08-04",
      end: "00:07",
      idempotencyKey: "schedule:midnight",
      lead,
      requestId: "request-midnight",
      requestNumber: "REQ-MIDNIGHT",
      start: "23:58",
      subject: "After-hours cutover",
    });

    expect(stepPayload(operation, "msp:schedule")).toMatchObject({
      scheduledEnd: "2026-08-05T00:15:00+10:00",
      scheduledStart: "2026-08-05T00:00:00+10:00",
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

  it("migrates a legacy saved Work Log without adding the Work Log again", () => {
    const operation = worklogOperation({
      actorEmail: "simeon@egit.com.au",
      command: {
        description: "Replaced the failed power supply.",
        disposition: "complete",
        durationMinutes: 30,
        endedAt: "2026-08-04T10:30:00+10:00",
        idempotencyKey: "legacy-worklog:request-42",
        requestId: "request-42",
        scheduled: true,
        startedAt: "2026-08-04T10:00:00+10:00",
        visibility: "external",
        workType: "billable",
      },
      ownerId: "msp-simeon",
      worklogAlreadySaved: true,
    });

    expect(operation.steps.some((step) => step.stepKey === "msp:worklog")).toBe(false);
    expect(operation.steps.map((step) => step.stepKey)).toEqual([
      "msp:status:resolved",
      "command:clear-schedule",
      "command:refresh",
    ]);
  });

  it("rounds Book Forward start and end to the next 15-minute boundary", () => {
    const operation = worklogOperation({
      actorEmail: "simeon@egit.com.au",
      command: {
        booking: {
          bookingType: "Remote",
          date: "2026-10-04",
          end: "11:07",
          requestNumber: "REQ-42",
          start: "10:07",
          subject: "Continue diagnostics",
          technicianId: "tech-simeon",
          technicianName: "Simeon",
          userPrincipalName: "simeon@egit.com.au",
        },
        description: "Initial diagnostics complete.",
        disposition: "book_forward",
        durationMinutes: 15,
        endedAt: "2026-08-04T10:15:00+10:00",
        idempotencyKey: "worklog:request-42:forward",
        requestId: "request-42",
        scheduled: true,
        startedAt: "2026-08-04T10:00:00+10:00",
        visibility: "external",
        workType: "billable",
      },
      ownerId: "msp-simeon",
    });
    const schedule = operation.steps.find(
      (step) => step.stepKey === "msp:book-forward",
    );
    const outlook = operation.steps.find(
      (step) => step.stepKey === "outlook:book-forward",
    );

    expect(schedule?.payload).toMatchObject({
      scheduledEnd: "2026-10-04T11:15:00+11:00",
      scheduledStart: "2026-10-04T10:15:00+11:00",
    });
    expect(outlook?.payload).toMatchObject({
      end: "2026-10-04T11:15:00",
      start: "2026-10-04T10:15:00",
    });
  });

  it.each([
    ["customer", "msp.send_reply", true],
    ["internal", "msp.add_note", false],
  ] as const)("maps %s Comms to the correct MSP action", (visibility, action, showToRequester) => {
    const operation = communicationOperation({
      actorEmail: "jervy@egit.com.au",
      body: "The replacement has arrived.",
      idempotencyKey: `comms:request-42:${visibility}:1`,
      occurredAt: "2026-08-04T10:00:00+10:00",
      requestId: "request-42",
      visibility,
    });

    expect(operation.steps[0]).toMatchObject({
      action,
      payload: {
        actorEmail: "jervy@egit.com.au",
        notifyTechnician: false,
        showToRequester,
        visibility,
      },
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

  it("builds a cancelled-request cleanup that deletes linked Outlook bookings", () => {
    const operation = cancelledScheduleCleanupOperation({
      actorEmail: "system@command.egit.com.au",
      events: [
        {
          eventId: "event-lead",
          technicianId: "tech-jervy",
          userPrincipalName: "jervy@egit.com.au",
        },
      ],
      idempotencyKey: "cancelled-cleanup:request-42:event-lead",
      requestId: "request-42",
      requestNumber: "REQ-42",
    });

    expect(operation.actionType).toBe("dispatch.cancelled_schedule_cleanup");
    expect(operation.steps).toEqual([
      {
        action: "outlook.delete_event",
        connector: "outlook",
        payload: {
          eventId: "event-lead",
          technicianId: "tech-jervy",
          userPrincipalName: "jervy@egit.com.au",
        },
        stepKey: expect.stringMatching(/^outlook:cleanup:tech-jervy:/),
      },
      {
        action: "command_centre.clear_schedule",
        connector: "command_centre",
        payload: { requestId: "request-42" },
        stepKey: "command:clear-schedule",
      },
      {
        action: "command_centre.invalidate_request",
        connector: "command_centre",
        payload: { requestId: "request-42" },
        stepKey: "command:refresh",
      },
    ]);
  });

  it("builds an orphaned Outlook cleanup for calendar bookings without active Helpdesk requests", () => {
    const operation = orphanedOutlookCleanupOperation({
      actorEmail: "system@command.egit.com.au",
      events: [
        {
          eventId: "event-matt",
          requestNumber: "237692",
          technicianId: "tech-matt",
          userPrincipalName: "mattd@egit.com.au",
        },
      ],
      idempotencyKey: "orphaned-outlook:237692:event-matt",
    });

    expect(operation.actionType).toBe("dispatch.orphaned_outlook_cleanup");
    expect(operation.requestId).toBe("outlook-orphan:237692");
    expect(operation.steps).toEqual([
      {
        action: "outlook.delete_event",
        connector: "outlook",
        payload: {
          eventId: "event-matt",
          technicianId: "tech-matt",
          userPrincipalName: "mattd@egit.com.au",
        },
        stepKey: expect.stringMatching(/^outlook:cleanup:tech-matt:/),
      },
    ]);
  });

  it("builds a deterministic request creation with a reconciliation fingerprint", () => {
    const input = {
      actorEmail: "simeon@egit.com.au",
      category: "Hardware",
      customer: "Example Co",
      customerId: "customer-1",
      contactId: "contact-1",
      description: "Printer cannot reach the network.",
      impact: "Affects User",
      idempotencyKey: "create-request:mobile:42",
      priority: "High" as const,
      requestType: "Incident",
      requesterEmail: "user@example.com",
      site: "Bairnsdale office",
      subcategory: "Printer",
      subject: "Printer offline",
      urgency: "High",
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
        category: "Hardware",
        contactId: "contact-1",
        customerId: "customer-1",
        impact: "Affects User",
        requestType: "Incident",
        subcategory: "Printer",
        urgency: "High",
      },
    });
    expect(first.requestId).toMatch(/^pending:/);
  });
});

function stepPayload(
  operation: ReturnType<typeof scheduleOperation>,
  stepKey: string,
) {
  const step = operation.steps.find((candidate) => candidate.stepKey === stepKey);
  if (!step) throw new Error(`Step ${stepKey} was not found.`);
  return step.payload;
}

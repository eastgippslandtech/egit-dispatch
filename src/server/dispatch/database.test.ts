import { describe, expect, it, vi } from "vitest";

import { createPostgresDispatchDashboardDatabase } from "./database";

describe("dispatch dashboard crew assignments", () => {
  it("loads crew assignments as appointments without duplicating requests", async () => {
    const statements: string[] = [];
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      statements.push(strings.join("?"));
      return [];
    }) as unknown as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
    const database = createPostgresDispatchDashboardDatabase({ sql: sql as never });

    await database.getDashboardData();

    const query = statements.join("\n");
    expect(query).toContain("public.dispatch_link_crew");
    expect(query).toContain("assignmentRole");
  });

  it("maps every assignment to its parent dispatch group and role", async () => {
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join("?");
      if (query.includes("from public.staff_profiles sp")) {
        return [staffRow("staff-matt", "tech-matt", "Matt", "mattd@egit.com.au")];
      }
      if (query.includes("with assignments as")) {
        return [
          assignmentRow("parent-link-1", "parent-link-1", "lead"),
          assignmentRow("crew-row-1", "parent-link-1", "crew"),
        ];
      }
      return [];
    }) as unknown as (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<unknown[]>;
    const database = createPostgresDispatchDashboardDatabase({ sql: sql as never });

    const result = await database.getDashboardData();

    expect(result.appointments).toEqual([
      expect.objectContaining({
        id: "parent-link-1",
        scheduleAssignmentRole: "lead",
        scheduleGroupId: "parent-link-1",
      }),
      expect.objectContaining({
        id: "crew-row-1",
        scheduleAssignmentRole: "crew",
        scheduleGroupId: "parent-link-1",
      }),
    ]);
    const dispatchQuery = vi
      .mocked(sql)
      .mock.calls.map(([strings]) => strings.join("?"))
      .find((query) => query.includes("with assignments as"));
    expect(dispatchQuery).toContain(
      'assignments.dispatch_link_id::text as "dispatchLinkId"',
    );
    expect(dispatchQuery).toContain(
      'assignments.assignment_role as "assignmentRole"',
    );
  });

  it("normalizes cached legacy MSP Central request links", async () => {
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join("?");
      if (query.includes("from public.staff_profiles sp")) {
        return [staffRow("staff-matt", "tech-matt", "Matt", "mattd@egit.com.au")];
      }
      if (query.includes("with assignments as")) {
        return [
          assignmentRow("parent-link-1", "parent-link-1", "lead", {
            payloadSummary: {
              helpdeskUrl:
                "https://mspcentral.manageengine.com.au/mainlayout#msp/helpdesk/app/memsp1783593801295/Requests/view/6768000001410416",
              subject: "Printer offline",
            },
            sdpRequestId: "6768000001410416",
          }),
        ];
      }
      return [];
    }) as unknown as (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<unknown[]>;
    const database = createPostgresDispatchDashboardDatabase({ sql: sql as never });

    const result = await database.getDashboardData();

    expect(result.requests[0]?.helpdeskUrl).toBe(
      "https://sdpod.mspcentral.manageengine.com.au/app/memsp1783593801295/ui/requests/6768000001410416/details",
    );
    expect(result.appointments[0]?.helpdeskUrl).toBe(
      "https://sdpod.mspcentral.manageengine.com.au/app/memsp1783593801295/ui/requests/6768000001410416/details",
    );
  });
});

function assignmentRow(
  id: string,
  dispatchLinkId: string,
  assignmentRole: "crew" | "lead",
  overrides: Partial<ReturnType<typeof baseAssignmentRow>> & {
    payloadSummary?: Record<string, unknown>;
  } = {},
) {
  return {
    ...baseAssignmentRow(id, dispatchLinkId, assignmentRole),
    ...overrides,
    notes: overrides.notes ?? [
      {
        action: "live_schedule",
        createdAt: "2026-08-04T00:00:00.000Z",
        message: "Scheduled",
        payloadSummary: {
          bookingType: "Onsite",
          customerName: "Example Co",
          subject: "Printer offline",
          ...(overrides.payloadSummary as Record<string, unknown> | undefined),
        },
        status: "success",
      },
    ],
  };
}

function baseAssignmentRow(
  id: string,
  dispatchLinkId: string,
  assignmentRole: "crew" | "lead",
) {
  return {
    assignmentRole,
    dispatchLinkId,
    id,
    lastSyncError: null,
    lastSyncStatus: "linked",
    notes: [
      {
        action: "live_schedule",
        createdAt: "2026-08-04T00:00:00.000Z",
        message: "Scheduled",
        payloadSummary: {
          bookingType: "Onsite",
          customerName: "Example Co",
          subject: "Printer offline",
        },
        status: "success",
      },
    ],
    outlookCalendarEmail: "mattd@egit.com.au",
    outlookEventId: `event-${id}`,
    scheduledEnd: "2026-08-04T01:00:00.000Z",
    scheduledStart: "2026-08-04T00:00:00.000Z",
    sdpRequestId: "request-1",
    sdpRequestNumber: "REQ-1",
    staffId: "staff-matt",
    technicianDisplayName: "Matt",
    technicianId: "tech-matt",
    technicianOutlookEmail: "mattd@egit.com.au",
    updatedAt: "2026-08-04T00:00:00.000Z",
  };
}

function staffRow(
  id: string,
  technicianId: string,
  displayName: string,
  email: string,
) {
  return {
    active: true,
    baseOffice: "Sale",
    calendarEnabled: true,
    displayName,
    dispatchEnabled: true,
    id,
    mspCentralEmail: email,
    mspCentralTechnicianId: "msp-tech-matt",
    mspCentralTechnicianName: displayName,
    outlookEmail: email,
    outlookUserPrincipalName: email,
    role: "technician",
    storeLocation: "Sale",
    technicianDisplayName: displayName,
    technicianId,
    technicianOutlookEmail: email,
    technicianSdpId: "msp-tech-matt",
    zohoEmail: email,
    zohoPeopleEmployeeId: null,
  };
}

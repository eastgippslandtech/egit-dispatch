import { describe, expect, it } from "vitest";

import { getInitialStaffProfiles } from "@/server/staff/profiles";

import {
  mapMspCentralPriority,
  mapMspCentralRequest,
  mapMspCentralRequests,
  mapMspCentralSlaState,
  mapMspCentralStatus,
  mapMspCentralTechnicians,
} from "./mappers";

describe("MSP Central request mappers", () => {
  const now = new Date("2026-07-09T09:00:00+10:00");

  it("maps fixture-style requests into Command Centre requests", () => {
    const request = mapMspCentralRequest(
      {
        account: { name: "Fixture Customer" },
        assets: [{ name: "Fixture printer" }],
        category: { name: "Hardware" },
        description: "Printer queue is stuck after driver update.",
        due_by_time: "2026-07-09T12:00:00+10:00",
        id: "msp-1",
        is_onsite: true,
        item: { name: "Printer" },
        priority: { name: "High" },
        request_number: "REQ-MSP-1",
        requester: { email: "person@example.invalid", name: "Pat" },
        site: {
          address: "Bairnsdale VIC 3875",
          area: "Bairnsdale",
          city: "Bairnsdale",
          name: "Main office",
        },
        status: { name: "Ready for Scheduling" },
        subcategory: { name: "Peripherals" },
        subject: "Fixture mapped request",
        technician: {
          email: "mattd@egit.com.au",
          id: "msp-tech-matt",
          name: "Matt",
        },
        udf_fields: { ready_to_book: true },
      },
      {
        now,
        requestWebBaseUrl: "https://helpdesk.example/requests/{request}",
      },
    );

    expect(request).toMatchObject({
      bookingType: "Onsite",
      customer: "Fixture Customer",
      helpdeskUrl: "https://helpdesk.example/requests/REQ-MSP-1",
      notes: "Printer queue is stuck after driver update.",
      priority: "High",
      readyToBook: true,
      requestNumber: "REQ-MSP-1",
      site: "Main office",
      slaState: "due-soon",
      sourceSystem: "msp-central-fixture",
      status: "Ready for Scheduling",
      technicianId: "tech-matt",
    });
    expect(request.assetNames).toEqual(["Fixture printer"]);
    expect(request).toMatchObject({
      category: "Hardware",
      item: "Printer",
      subcategory: "Peripherals",
    });
  });

  it("handles null and missing fields safely", () => {
    const request = mapMspCentralRequest(
      {
        assets: null,
        id: null,
        priority: null,
        requester: null,
        site: null,
        status: null,
        technician: null,
      },
      { now },
    );

    expect(request).toMatchObject({
      customer: "Unknown customer",
      priority: "Medium",
      requestNumber: "REQ-UNKNOWN",
      requester: "Unknown requester",
      site: "Unknown site",
      status: "Open",
      subject: "Untitled MSP Central request",
    });
    expect(request.warnings).toContain("Assets unavailable");
    expect(request.warnings).toContain(
      "No staff profile matched the MSP Central technician.",
    );
  });

  it("maps priority, status, due, and scheduled classification", () => {
    expect(mapMspCentralPriority("urgent")).toBe("Critical");
    expect(mapMspCentralPriority("low")).toBe("Low");
    expect(mapMspCentralStatus("Scheduled", "2026-07-09T09:00:00+10:00")).toBe(
      "Scheduled",
    );
    expect(mapMspCentralStatus("closed")).toBe("Resolved");
    expect(mapMspCentralSlaState("violated", undefined, now)).toBe("overdue");
    expect(
      mapMspCentralSlaState(
        undefined,
        "2026-07-09T12:00:00+10:00",
        now,
      ),
    ).toBe("due-soon");
  });

  it("prefers MSP technician ID and warns on display-name-only matches", () => {
    const [profile] = getInitialStaffProfiles();
    const request = mapMspCentralRequest(
      {
        due_by_time: "2026-07-10T12:00:00+10:00",
        request_number: "REQ-MSP-ID",
        technician: { email: "other@example.invalid", id: "msp-id", name: "Other" },
      },
      {
        now,
        profiles: [{ ...profile, mspCentralTechnicianId: "msp-id" }],
      },
    );

    expect(request.technicianId).toBe("tech-simeon");

    const displayNameOnly = mapMspCentralRequest(
      {
        due_by_time: "2026-07-10T12:00:00+10:00",
        request_number: "REQ-MSP-NAME",
        technician: { name: "Riley" },
      },
      { now },
    );

    expect(displayNameOnly.technicianId).toBe("tech-riley");
    expect(displayNameOnly.warnings).toContain(
      "Display name match requires manual review.",
    );
  });

  it("maps request and technician lists", () => {
    const requests = mapMspCentralRequests([
      {
        due_by_time: "2026-07-10T12:00:00+10:00",
        request_number: "REQ-MSP-LIST",
      },
    ]);
    const technicians = mapMspCentralTechnicians([
      { email: "jervy@egit.com.au", id: "msp-jervy", name: "Jervy" },
    ]);

    expect(requests).toHaveLength(1);
    expect(technicians).toEqual([
      expect.objectContaining({ displayName: "Jervy", id: "tech-jervy" }),
    ]);
  });
});

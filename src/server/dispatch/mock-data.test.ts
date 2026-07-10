import { describe, expect, it } from "vitest";

import { getDispatchDesignMockData } from "./mock-data";

describe("dispatch design mock data", () => {
  it("uses one realistic shared data set for every design option", () => {
    const data = getDispatchDesignMockData();

    expect(data.technicians).toHaveLength(4);
    expect(data.requests.length).toBeGreaterThanOrEqual(20);
    expect(data.appointments.length).toBeGreaterThanOrEqual(8);
    expect(data.requests.some((request) => request.slaState === "overdue")).toBe(
      true,
    );
    expect(data.appointments.some((appointment) => appointment.syncIssue)).toBe(
      true,
    );
  });

  it("uses the Phase 1 EGIT technician sample names and customer examples", () => {
    const data = getDispatchDesignMockData();

    expect(data.technicians.map((technician) => technician.displayName)).toEqual(
      ["Matt", "Jervy", "Riley", "Simeon"],
    );
    expect(data.requests.map((request) => request.customer)).toEqual(
      expect.arrayContaining([
        "OneHarvest",
        "Decor Floors",
        "Lakeside Motel",
        "East Gippsland Homes",
        "Sale Family Dentist",
        "Internal EGIT",
      ]),
    );
  });

  it("projects dispatch technicians from staff identity profiles", () => {
    const data = getDispatchDesignMockData();
    const matt = data.technicians.find(
      (technician) => technician.displayName === "Matt",
    );

    expect(matt).toMatchObject({
      mspCentralEmail: "mattd@egit.com.au",
      outlookEmail: "mattd@egit.com.au",
      outlookUserPrincipalName: "mattd@egit.com.au",
      role: "technician",
      zohoEmail: "mattd@egit.com.au",
    });
  });

  it("includes the warnings needed to compare sync and SLA states", () => {
    const data = getDispatchDesignMockData();
    const warningKeys = data.healthItems.map((item) => item.key);

    expect(warningKeys).toContain("sla-risk");
    expect(warningKeys).toContain("double-booked");
    expect(warningKeys).toContain("missing-calendar");
    expect(warningKeys).toContain("time-mismatch");
    expect(warningKeys).toContain("past-open");
  });

  it("adds V1 office-based travel context to travel appointments", () => {
    const data = getDispatchDesignMockData();
    const travelAppointment = data.appointments.find(
      (appointment) => appointment.travelToSiteMinutes,
    );

    expect(travelAppointment).toMatchObject({
      travelCalculatedFrom: "technician_base_office",
      travelCalculationReason: "Estimated from technician base office",
      travelMode: "office_to_site_and_back",
    });
  });

  it("uses the Phase 1 Dispatch Health card labels", () => {
    const data = getDispatchDesignMockData();

    expect(data.healthItems.map((item) => item.label)).toEqual([
      "Unscheduled Requests",
      "SLA Risk",
      "Double Bookings",
      "Missing Calendar Events",
      "Sync Issues",
      "Past Scheduled Open Jobs",
      "Missing Technician Mapping",
      "Travel Conflicts",
      "Out-of-Hours Bookings",
      "Unlinked Outlook Events",
      "Closed-Day Bookings",
      "All-Day Calendar Blocks",
    ]);
    expect(data.healthItems.every((item) => item.description.length > 0)).toBe(
      true,
    );
  });
});

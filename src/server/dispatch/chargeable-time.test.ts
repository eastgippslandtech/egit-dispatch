import { describe, expect, it } from "vitest";

import { getChargeableTicketTime } from "./chargeable-time";

describe("chargeable ticket time", () => {
  const appointment = {
    customer: "Example",
    end: "11:00",
    id: "appointment-1",
    source: "linked" as const,
    start: "10:00",
    status: "confirmed" as const,
    technicianId: "tech-matt",
    title: "Onsite service",
    travelBackToOfficeMinutes: 20,
    travelToSiteMinutes: 15,
  };

  it("charges onsite travel inside the ticket Work Log", () => {
    expect(
      getChargeableTicketTime({ appointment, bookingType: "Onsite" }),
    ).toEqual({
      jobMinutes: 60,
      totalMinutes: 105,
      travelMinutes: 35,
    });
  });

  it("does not add travel to remote or in-house ticket time", () => {
    expect(
      getChargeableTicketTime({ appointment, bookingType: "Remote" }),
    ).toMatchObject({ totalMinutes: 60, travelMinutes: 0 });
    expect(
      getChargeableTicketTime({ appointment, bookingType: "In house" }),
    ).toMatchObject({ totalMinutes: 60, travelMinutes: 0 });
  });
});

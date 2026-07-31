import { describe, expect, it } from "vitest";

import {
  applyBookingTypeToRequest,
  bookingTiming,
  bookingTypeForRequest,
} from "./booking";

describe("dispatch booking types", () => {
  it("keeps an explicitly selected booking type", () => {
    expect(
      bookingTypeForRequest({
        bookingType: "In house",
        customer: "OneHarvest",
        onsite: true,
        site: "Main office",
      }),
    ).toBe("In house");
  });

  it("adds note time only to onsite work", () => {
    expect(bookingTiming(60, "Onsite")).toEqual({
      noteTimeMinutes: 15,
      totalDurationMinutes: 75,
      workDurationMinutes: 60,
    });
    expect(bookingTiming(60, "Remote").totalDurationMinutes).toBe(60);
    expect(bookingTiming(60, "In house").totalDurationMinutes).toBe(60);
  });

  it("infers remote and onsite work from request context", () => {
    expect(
      bookingTypeForRequest({
        customer: "Example Co",
        notes: "Please assist the user remotely via Teams.",
        onsite: undefined,
        site: "Unknown site",
        subject: "Microsoft 365 support",
      }),
    ).toBe("Remote");
    expect(
      bookingTypeForRequest({
        customer: "Example Co",
        notes: "Technician required for an onsite visit.",
        onsite: undefined,
        site: "Sale showroom",
        siteAddress: "1 Raymond Street, Sale VIC 3850",
        subject: "Printer offline",
      }),
    ).toBe("Onsite");
  });

  it("defaults unknown work to onsite so travel is not silently omitted", () => {
    expect(
      bookingTypeForRequest({
        customer: "Example Co",
        onsite: undefined,
        site: "Unknown site",
        subject: "Printer offline",
      }),
    ).toBe("Onsite");
  });

  it("removes stale remote location metadata when switched to onsite", () => {
    const request = applyBookingTypeToRequest(
      {
        bookingType: "Remote",
        customer: "EGIT Training",
        onsite: false,
        mockTravelMinutes: 0,
        site: "Remote / Virtual",
        siteTown: "Remote",
      },
      "Onsite",
    );

    expect(request).toMatchObject({
      bookingType: "Onsite",
      onsite: true,
    });
    expect(request.siteTown).toBeUndefined();
    expect(request.mockTravelMinutes).toBeUndefined();
  });
});

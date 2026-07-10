import { describe, expect, it } from "vitest";

import { bookingTiming, bookingTypeForRequest } from "./booking";

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

  it("normalises remote, in-house, and onsite requests", () => {
    expect(
      bookingTypeForRequest({
        customer: "OneHarvest",
        onsite: false,
        site: "Main office",
      }),
    ).toBe("Remote");
    expect(
      bookingTypeForRequest({
        customer: "OneHarvest",
        onsite: true,
        site: "Remote session",
      }),
    ).toBe("Remote");
    expect(
      bookingTypeForRequest({
        customer: "Internal EGIT",
        onsite: true,
        site: "Bairnsdale office",
      }),
    ).toBe("In house");
    expect(
      bookingTypeForRequest({
        customer: "OneHarvest",
        onsite: true,
        site: "EGIT workshop",
      }),
    ).toBe("In house");
    expect(
      bookingTypeForRequest({
        customer: "OneHarvest",
        onsite: true,
        site: "Packing floor",
      }),
    ).toBe("Onsite");
  });

  it("adds note time only to onsite work", () => {
    expect(bookingTiming(60, "Onsite")).toEqual({
      noteTimeMinutes: 15,
      totalDurationMinutes: 75,
      workDurationMinutes: 60,
    });
    expect(bookingTiming(60, "Remote")).toEqual({
      noteTimeMinutes: 0,
      totalDurationMinutes: 60,
      workDurationMinutes: 60,
    });
    expect(bookingTiming(60, "In house")).toEqual({
      noteTimeMinutes: 0,
      totalDurationMinutes: 60,
      workDurationMinutes: 60,
    });
  });
});

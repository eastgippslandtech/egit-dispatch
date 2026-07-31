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

  it("adds note time only to onsite work", () => {
    expect(bookingTiming(60, "Onsite")).toEqual({
      noteTimeMinutes: 15,
      totalDurationMinutes: 75,
      workDurationMinutes: 60,
    });
    expect(bookingTiming(60, "Remote").totalDurationMinutes).toBe(60);
    expect(bookingTiming(60, "In house").totalDurationMinutes).toBe(60);
  });
});

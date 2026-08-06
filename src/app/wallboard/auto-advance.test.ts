import { describe, expect, it } from "vitest";

import { getWallboardDateAfterRefresh } from "./auto-advance";

describe("wallboard date auto-advance", () => {
  it("keeps today selected before the 5 PM Melbourne close", () => {
    expect(
      getWallboardDateAfterRefresh({
        lastAutoAdvancedDateKey: undefined,
        now: new Date("2026-07-29T06:59:00.000Z"),
        selectedDateKey: "2026-07-29",
      }),
    ).toEqual({
      autoAdvancedFromDateKey: undefined,
      selectedDateKey: "2026-07-29",
    });
  });

  it("advances today to the next working day on the first refresh after 5 PM", () => {
    expect(
      getWallboardDateAfterRefresh({
        lastAutoAdvancedDateKey: undefined,
        now: new Date("2026-07-29T07:00:00.000Z"),
        selectedDateKey: "2026-07-29",
      }),
    ).toEqual({
      autoAdvancedFromDateKey: "2026-07-29",
      selectedDateKey: "2026-07-30",
    });
  });

  it("advances Friday evening to Monday", () => {
    expect(
      getWallboardDateAfterRefresh({
        lastAutoAdvancedDateKey: undefined,
        now: new Date("2026-07-31T07:01:00.000Z"),
        selectedDateKey: "2026-07-31",
      }),
    ).toEqual({
      autoAdvancedFromDateKey: "2026-07-31",
      selectedDateKey: "2026-08-03",
    });
  });

  it("catches up to today when the display missed the previous evening refresh", () => {
    expect(
      getWallboardDateAfterRefresh({
        lastAutoAdvancedDateKey: undefined,
        now: new Date("2026-07-29T23:30:00.000Z"),
        selectedDateKey: "2026-07-29",
      }),
    ).toEqual({
      autoAdvancedFromDateKey: undefined,
      selectedDateKey: "2026-07-30",
    });
  });

  it("does not override a manually selected date", () => {
    expect(
      getWallboardDateAfterRefresh({
        lastAutoAdvancedDateKey: undefined,
        now: new Date("2026-07-29T07:01:00.000Z"),
        selectedDateKey: "2026-07-31",
      }),
    ).toEqual({
      autoAdvancedFromDateKey: undefined,
      selectedDateKey: "2026-07-31",
    });
  });
});

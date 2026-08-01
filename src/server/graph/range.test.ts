import { describe, expect, it } from "vitest";

import {
  buildGraphDayRange,
  buildGraphPlanningRange,
  buildGraphWorkWeekRange,
} from "./range";

describe("Graph calendar range helpers", () => {
  it("builds a day view range for calendarView", () => {
    expect(buildGraphDayRange("2026-07-08")).toEqual({
      endDateTime: "2026-07-09T00:00:00",
      startDateTime: "2026-07-08T00:00:00",
    });
  });

  it("builds a Monday-Friday work week range for calendarView", () => {
    expect(buildGraphWorkWeekRange("2026-07-08")).toEqual({
      endDateTime: "2026-07-11T00:00:00",
      startDateTime: "2026-07-06T00:00:00",
    });
  });

  it("includes the upcoming work week when today is a weekend", () => {
    expect(buildGraphPlanningRange("2026-08-01")).toEqual({
      endDateTime: "2026-08-08T00:00:00",
      startDateTime: "2026-07-27T00:00:00",
    });
  });
});

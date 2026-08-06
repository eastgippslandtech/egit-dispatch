import { describe, expect, it } from "vitest";

import {
  displayDateLabel,
  jobDateKey,
  relativeDateTitle,
  shiftDateKey,
  todayDateKey,
} from "./date-keys";

describe("schedule date keys", () => {
  it("uses the current Melbourne calendar date for today", () => {
    expect(todayDateKey(new Date("2026-07-12T01:00:00.000Z"))).toBe(
      "2026-07-12",
    );
  });

  it("moves forward and backward one calendar day without UTC drift", () => {
    expect(shiftDateKey("2026-07-12", 1)).toBe("2026-07-13");
    expect(shiftDateKey("2026-07-12", -1)).toBe("2026-07-11");
  });

  it("labels only the real selected day as Today", () => {
    const now = new Date("2026-07-12T01:00:00.000Z");

    expect(relativeDateTitle("2026-07-11", now)).toBe("Yesterday");
    expect(relativeDateTitle("2026-07-12", now)).toBe("Today");
    expect(relativeDateTitle("2026-07-13", now)).toBe("Tomorrow");
    expect(relativeDateTitle("2026-07-14", now)).toBe("Schedule");
  });

  it("formats the selected calendar date in Melbourne time", () => {
    expect(displayDateLabel("2026-07-12")).toBe("Sunday, 12 July");
  });

  it("derives a job date in the job timezone", () => {
    expect(jobDateKey("2026-07-14T23:30:00.000Z")).toBe("2026-07-15");
    expect(jobDateKey("2026-07-14T23:30:00.000Z", "UTC")).toBe(
      "2026-07-14",
    );
  });
});

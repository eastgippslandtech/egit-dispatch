import { describe, expect, it } from "vitest";

import {
  getCurrentTimeIndicator,
  getWeekTodayDateKey,
  isTodayInDispatchTimezone,
} from "./current-time";
import { getTimelineItemPosition, getTimelinePosition } from "./scheduling";

const noonMelbourne = new Date("2026-07-08T02:00:00.000Z");

describe("dispatch current-time indicator", () => {
  it("shows the day indicator when the selected date is today in Melbourne", () => {
    const indicator = getCurrentTimeIndicator("2026-07-08", noonMelbourne);

    expect(indicator.visible).toBe(true);
    expect(indicator.label).toBe("12:00 PM");
  });

  it("hides the day indicator when the selected date is not today in Melbourne", () => {
    const indicator = getCurrentTimeIndicator("2026-07-09", noonMelbourne);

    expect(indicator.visible).toBe(false);
  });

  it("maps current time to the workday timeline position", () => {
    expect(
      getCurrentTimeIndicator(
        "2026-07-08",
        new Date("2026-07-07T23:00:00.000Z"),
      ),
    ).toMatchObject({ positionPercent: 0 });

    expect(
      getCurrentTimeIndicator(
        "2026-07-08",
        new Date("2026-07-08T02:00:00.000Z"),
      ).positionPercent,
    ).toBeCloseTo(35.29, 2);

    expect(
      getCurrentTimeIndicator(
        "2026-07-08",
        new Date("2026-07-08T07:30:00.000Z"),
      ),
    ).toMatchObject({ positionPercent: 100 });
  });

  it("uses the shared timeline scale for the current-time marker", () => {
    const indicator = getCurrentTimeIndicator("2026-07-08", noonMelbourne);
    const noonPosition = getTimelinePosition({
      itemEnd: "12:00",
      itemStart: "12:00",
    });
    const noonPixelPosition = getTimelineItemPosition({
      itemEnd: "12:00",
      itemStart: "12:00",
    });

    expect(indicator.positionPercent).toBeCloseTo(
      noonPosition.leftPercent,
      5,
    );
    expect(indicator.positionPx).toBe(noonPixelPosition.leftPx);
  });

  it("clamps before-hours and after-hours positions to the workday edges", () => {
    expect(
      getCurrentTimeIndicator(
        "2026-07-08",
        new Date("2026-07-07T22:30:00.000Z"),
      ),
    ).toMatchObject({
      elapsedWidthPercent: 0,
      positionPercent: 0,
      visible: true,
    });

    expect(
      getCurrentTimeIndicator(
        "2026-07-08",
        new Date("2026-07-08T08:00:00.000Z"),
      ),
    ).toMatchObject({
      elapsedWidthPercent: 100,
      positionPercent: 100,
      visible: true,
    });
  });

  it("detects today using the dispatch timezone", () => {
    expect(isTodayInDispatchTimezone("2026-07-08", noonMelbourne)).toBe(true);
    expect(isTodayInDispatchTimezone("2026-07-07", noonMelbourne)).toBe(false);
  });

  it("returns only today's date key for week highlighting", () => {
    const weekDays = [
      { dateKey: "2026-07-06" },
      { dateKey: "2026-07-07" },
      { dateKey: "2026-07-08" },
      { dateKey: "2026-07-09" },
    ];

    expect(getWeekTodayDateKey(weekDays, noonMelbourne)).toBe("2026-07-08");
    expect(
      getWeekTodayDateKey([{ dateKey: "2026-07-09" }], noonMelbourne),
    ).toBeUndefined();
  });
});

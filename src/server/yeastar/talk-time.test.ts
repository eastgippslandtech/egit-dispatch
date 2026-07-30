import { describe, expect, it } from "vitest";

import {
  attributeExternalTalkSegments,
  formatTalkTime,
  getMelbourneWeekRange,
  isReportableExternalCall,
} from "./talk-time";

describe("external call reporting", () => {
  it("includes answered trunk calls with connected talk time", () => {
    expect(
      isReportableExternalCall({
        answered: true,
        callType: "Inbound",
        connectedTalkSeconds: 83,
        hasExternalParty: true,
        hasTrunk: true,
      }),
    ).toBe(true);
  });

  it.each([
    { answered: false, callType: "Inbound", connectedTalkSeconds: 0, hasExternalParty: true, hasTrunk: true },
    { answered: true, callType: "Internal", connectedTalkSeconds: 60, hasExternalParty: false, hasTrunk: false },
    { answered: true, callType: "Voicemail", connectedTalkSeconds: 60, hasExternalParty: true, hasTrunk: true },
  ])("excludes non-reportable calls", (call) => {
    expect(isReportableExternalCall(call)).toBe(false);
  });

  it("attributes transferred call time to each connected technician segment", () => {
    expect(
      attributeExternalTalkSegments([
        { extension: "201", segmentId: "a", talkSeconds: 75 },
        { extension: "202", segmentId: "b", talkSeconds: 125 },
        { extension: "201", segmentId: "a", talkSeconds: 75 },
      ]),
    ).toEqual([
      { extension: "201", segmentId: "a", talkSeconds: 75 },
      { extension: "202", segmentId: "b", talkSeconds: 125 },
    ]);
  });

  it("uses a Monday-based Melbourne week", () => {
    expect(
      getMelbourneWeekRange(new Date("2026-07-30T03:00:00.000Z")),
    ).toEqual({
      end: "2026-07-30T03:00:00.000Z",
      start: "2026-07-26T14:00:00.000Z",
    });
  });

  it.each([
    [0, "0m"],
    [42 * 60, "42m"],
    [3 * 3600 + 42 * 60, "3h 42m"],
  ])("formats %s seconds as %s", (seconds, expected) => {
    expect(formatTalkTime(seconds)).toBe(expected);
  });
});

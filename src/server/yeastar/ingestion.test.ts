import { describe, expect, it } from "vitest";

import { normalizeYeastarCdr } from "./ingestion";

describe("normalizeYeastarCdr", () => {
  it("subtracts separately reported hold time and maps transferred segments", () => {
    const call = normalizeYeastarCdr(
      {
        basic: {
          call_from_number: "0351501000",
          call_to_number: "6000",
          call_type: "Inbound",
          last_status: "ANSWERED",
          talk_duration: 180,
          time: "2026/07/30 10:00:00",
          uid: "cdr-1",
        },
        timeline: [
          {
            call_duration: 80,
            call_to_number: "201",
            call_type: "Inbound",
            cdr_id: "leg-1",
            hold_duration: 10,
            ring_duration: 5,
            src_trunk: "Telstra",
            status: "ANSWERED",
            talk_duration: 60,
            time: "2026/07/30 10:00:00",
          },
          {
            call_duration: 125,
            call_to_number: "202",
            call_type: "Inbound",
            cdr_id: "leg-2",
            dst_trunk: "Telstra",
            hold_duration: 0,
            ring_duration: 5,
            status: "ANSWERED",
            talk_duration: 120,
            time: "2026/07/30 10:01:00",
          },
        ],
      },
      new Map([
        ["201", { staffId: "staff-1" }],
        ["202", { staffId: "staff-2" }],
      ]),
    );

    expect(call?.externalNumber).toBe("0351501000");
    expect(call?.segments.map((segment) => segment.talkSeconds)).toEqual([50, 120]);
    expect(call?.connectedTalkSeconds).toBe(170);
  });

  it("ignores internal and unanswered calls", () => {
    expect(
      normalizeYeastarCdr({
        basic: {
          call_from_number: "201",
          call_to_number: "202",
          call_type: "Internal",
          last_status: "ANSWERED",
          talk_duration: 60,
          time: "2026/07/30 10:00:00",
          uid: "cdr-2",
        },
        timeline: [],
      }),
    ).toBeUndefined();
  });
});

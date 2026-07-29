import { describe, expect, it } from "vitest";

import { MOBILE_JOB_FIXTURES } from "../../testing/fixtures";
import { getMobileChargeableTime } from "./chargeable-time";

describe("mobile chargeable time", () => {
  it("includes both travel legs for onsite ticket time", () => {
    const baseJob = MOBILE_JOB_FIXTURES[0];
    const result = getMobileChargeableTime({
      ...baseJob,
      bookingType: "Onsite",
      endAt: "2026-07-09T11:00:00+10:00",
      startAt: "2026-07-09T10:00:00+10:00",
      travel: {
        baseOfficeAddress: "137 Main Street",
        baseOfficeName: "Bairnsdale",
        calculatedFrom: "technician_base_office",
        calculationReason: "Office estimate",
        estimated: true,
        mode: "office_to_site_and_back",
        travelBackToOfficeMinutes: 20,
        travelToSiteMinutes: 15,
      },
    });

    expect(result).toEqual({
      jobMinutes: 60,
      totalMinutes: 95,
      travelMinutes: 35,
    });
  });
});

import { describe, expect, it } from "vitest";

import { getCommandCentreTrainingRequests } from "./training-data";

describe("Command Centre training requests", () => {
  it("provides one Remote and one Onsite example for every technician", () => {
    const requests = getCommandCentreTrainingRequests("2026-07-29");

    expect(requests).toHaveLength(8);

    for (const technicianId of [
      "tech-simeon",
      "tech-matt",
      "tech-jervy",
      "tech-riley",
    ]) {
      expect(
        requests
          .filter((request) => request.technicianId === technicianId)
          .map((request) => request.bookingType)
          .sort(),
      ).toEqual(["Onsite", "Remote"]);
    }
  });

  it("keeps the examples local, unscheduled, and ready for drag-and-drop", () => {
    const requests = getCommandCentreTrainingRequests("2026-07-29");

    expect(
      requests.every(
        (request) =>
          request.sourceSystem === "mock" &&
          request.status === "Ready for Scheduling" &&
          request.readyToBook &&
          !request.scheduledStart &&
          !request.scheduledEnd,
      ),
    ).toBe(true);
    expect(requests.every((request) => request.dueAt.startsWith("2026-07-29"))).toBe(
      true,
    );
  });

  it("uses no travel for Remote jobs and 15 minutes each way for Onsite jobs", () => {
    const requests = getCommandCentreTrainingRequests("2026-07-29");
    const remote = requests.filter((request) => request.bookingType === "Remote");
    const onsite = requests.filter((request) => request.bookingType === "Onsite");

    expect(
      remote.every(
        (request) =>
          request.onsite === false && request.mockTravelMinutes === 0,
      ),
    ).toBe(true);
    expect(
      onsite.every(
        (request) =>
          request.onsite === true && request.mockTravelMinutes === 15,
      ),
    ).toBe(true);
  });
});

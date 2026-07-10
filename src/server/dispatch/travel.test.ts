import { describe, expect, it } from "vitest";

import {
  detectTravelScheduleWarnings,
  estimateOfficeToSiteTravel,
  getAppointmentTravelContext,
  getBlockedWindow,
  getAppointmentBlockedWindow,
  getOfficeForTechnician,
  getTechnicianBaseOffice,
  roundTravelMinutes,
} from "./travel";
import type { Appointment, Technician } from "./types";

const bairnsdaleTechnician: Technician = {
  id: "tech-jervy",
  active: true,
  baseOfficeAddress: "137 Main Street, Bairnsdale VIC 3875",
  baseOfficeId: "bairnsdale",
  baseOfficeName: "Bairnsdale",
  displayName: "Jervy",
  mappingStatus: "mapped",
  outlookEmail: "jervy@example.com",
  storeLocation: "Bairnsdale",
};

const saleTechnician: Technician = {
  ...bairnsdaleTechnician,
  id: "tech-matt",
  baseOfficeAddress: "387 Raymond Street, Sale VIC 3850",
  baseOfficeId: "sale",
  baseOfficeName: "Sale",
  displayName: "Matt",
  outlookEmail: "matt@example.com",
  storeLocation: "Sale",
};

const baseAppointment: Appointment = {
  id: "appt-1",
  customer: "OneHarvest",
  date: "2026-07-08",
  end: "11:00",
  source: "linked",
  start: "10:00",
  status: "confirmed",
  technicianId: "tech-jervy",
  title: "Onsite job",
  travelBackToOfficeMinutes: 20,
  travelToSiteMinutes: 20,
};

describe("mock dispatch travel helpers", () => {
  it.each([
    [0, 0],
    [1, 5],
    [4, 5],
    [5, 5],
    [6, 10],
    [12, 15],
    [21, 25],
    [25, 25],
    [26, 30],
    [70, 70],
  ])("rounds %i travel minutes up to %i", (input, expected) => {
    expect(roundTravelMinutes(input)).toBe(expected);
  });

  it("selects the technician base office", () => {
    expect(getOfficeForTechnician(saleTechnician)).toEqual({
      id: "sale",
      name: "Sale",
      address: "387 Raymond Street, Sale VIC 3850",
    });
    expect(getTechnicianBaseOffice(saleTechnician)).toEqual(
      getOfficeForTechnician(saleTechnician),
    );
  });

  it("estimates office-to-site travel from lookup values", () => {
    expect(
      estimateOfficeToSiteTravel(getOfficeForTechnician(bairnsdaleTechnician), {
        siteAddress: "387 Raymond Street, Sale VIC 3850",
        siteTown: "Sale",
      }),
    ).toMatchObject({
      travelCalculatedFrom: "technician_base_office",
      travelBackToOfficeMinutes: 70,
      travelCalculationReason: "Estimated from technician base office",
      travelEstimated: false,
      travelMode: "office_to_site_and_back",
      travelToSiteMinutes: 70,
    });

    expect(
      estimateOfficeToSiteTravel(getOfficeForTechnician(saleTechnician), {
        siteAddress: "Maffra VIC 3860",
        siteTown: "Maffra",
      }).travelToSiteMinutes,
    ).toBe(25);
  });

  it("keeps remote jobs at zero travel", () => {
    expect(
      estimateOfficeToSiteTravel(getOfficeForTechnician(bairnsdaleTechnician), {
        onsite: false,
        siteAddress: "Remote",
        siteTown: "Remote",
      }),
    ).toMatchObject({
      travelCalculatedFrom: "technician_base_office",
      travelBackToOfficeMinutes: 0,
      travelCalculationReason: "Remote job: no travel buffer",
      travelEstimated: false,
      travelMode: "office_to_site_and_back",
      travelToSiteMinutes: 0,
    });
  });

  it("uses rounded fallback travel for unknown sites", () => {
    expect(
      estimateOfficeToSiteTravel(getOfficeForTechnician(bairnsdaleTechnician), {
        siteAddress: "Somewhere VIC",
        siteTown: "Unknown",
      }),
    ).toMatchObject({
      travelBackToOfficeMinutes: 15,
      travelEstimated: true,
      travelToSiteMinutes: 15,
      travelWarning: "estimated travel",
    });
  });

  it("calculates the full technician blocked window", () => {
    expect(getAppointmentBlockedWindow(baseAppointment)).toEqual({
      blockedEnd: "11:20",
      blockedStart: "09:40",
      jobEnd: "11:00",
      jobStart: "10:00",
    });
    expect(getBlockedWindow(baseAppointment)).toEqual(
      getAppointmentBlockedWindow(baseAppointment),
    );
  });

  it("exposes appointment travel context for future travel modes", () => {
    expect(
      getAppointmentTravelContext({
        ...baseAppointment,
        siteArea: "Bairnsdale",
        travelCalculatedFrom: "technician_base_office",
        travelCalculationReason: "Estimated from technician base office",
        travelEstimated: false,
        travelMode: "office_to_site_and_back",
      }),
    ).toEqual({
      siteArea: "Bairnsdale",
      travelCalculatedFrom: "technician_base_office",
      travelCalculationReason: "Estimated from technician base office",
      travelEstimated: false,
      travelMode: "office_to_site_and_back",
    });
  });

  it("detects travel-only overlap separately from job overlap", () => {
    const warnings = detectTravelScheduleWarnings({
      appointment: {
        ...baseAppointment,
        id: "candidate",
        start: "11:20",
        end: "12:20",
        travelToSiteMinutes: 25,
      },
      appointments: [
        {
          ...baseAppointment,
          id: "previous",
          end: "11:00",
          start: "10:00",
          travelBackToOfficeMinutes: 10,
          travelToSiteMinutes: 10,
        },
      ],
    });

    expect(warnings.map((warning) => warning.message)).toContain(
      "Travel to site overlaps the previous booking.",
    );
  });

  it("detects out-of-hours caused by travel buffers", () => {
    const warnings = detectTravelScheduleWarnings({
      appointment: {
        ...baseAppointment,
        end: "17:20",
        start: "16:20",
        travelBackToOfficeMinutes: 20,
      },
      appointments: [],
    });

    expect(warnings.map((warning) => warning.message)).toContain(
      "Return travel ends after working hours.",
    );
  });

  it("recalculates office and travel when technician changes", () => {
    const bairnsdaleEstimate = estimateOfficeToSiteTravel(
      getOfficeForTechnician(bairnsdaleTechnician),
      { siteAddress: "Sale VIC 3850", siteTown: "Sale" },
    );
    const saleEstimate = estimateOfficeToSiteTravel(
      getOfficeForTechnician(saleTechnician),
      { siteAddress: "Sale VIC 3850", siteTown: "Sale" },
    );

    expect(bairnsdaleEstimate.travelToSiteMinutes).toBe(70);
    expect(saleEstimate.travelToSiteMinutes).toBe(10);
  });
});

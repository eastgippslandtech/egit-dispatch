import { describe, expect, it } from "vitest";

import {
  findStaffForMspCentralTechnician,
  getInitialStaffProfiles,
} from "./profiles";

describe("staff identity mapping", () => {
  it("keeps Zoho and MSP Central email aligned for the initial EGIT staff", () => {
    const profiles = getInitialStaffProfiles();

    expect(
      profiles.map((profile) => ({
        mspCentralEmail: profile.mspCentralEmail,
        zohoEmail: profile.zohoEmail,
      })),
    ).toEqual([
      {
        mspCentralEmail: "simeon@egit.com.au",
        zohoEmail: "simeon@egit.com.au",
      },
      {
        mspCentralEmail: "mattd@egit.com.au",
        zohoEmail: "mattd@egit.com.au",
      },
      {
        mspCentralEmail: "jervy@egit.com.au",
        zohoEmail: "jervy@egit.com.au",
      },
      {
        mspCentralEmail: "riley@egit.com.au",
        zohoEmail: "riley@egit.com.au",
      },
    ]);
    expect(profiles.every((profile) => profile.dispatchEnabled)).toBe(true);
    expect(profiles.every((profile) => profile.calendarEnabled)).toBe(true);
  });

  it("uses mattd@egit.com.au as Matt's staff identity across systems", () => {
    const matt = getInitialStaffProfiles().find(
      (profile) => profile.id === "staff-matt",
    );

    expect(matt).toMatchObject({
      mspCentralEmail: "mattd@egit.com.au",
      outlookEmail: "mattd@egit.com.au",
      outlookUserPrincipalName: "mattd@egit.com.au",
      zohoEmail: "mattd@egit.com.au",
    });
  });

  it("keeps the canonical MSP technician IDs for every authorised staff member", () => {
    expect(
      getInitialStaffProfiles().map((profile) => ({
        email: profile.mspCentralEmail,
        id: profile.mspCentralTechnicianId,
        name: profile.mspCentralTechnicianName,
      })),
    ).toEqual([
      {
        email: "simeon@egit.com.au",
        id: "6768000000303165",
        name: "Simeon",
      },
      {
        email: "mattd@egit.com.au",
        id: "6768000000313963",
        name: "Matt Doyle",
      },
      {
        email: "jervy@egit.com.au",
        id: "6768000000319012",
        name: "Jervy",
      },
      {
        email: "riley@egit.com.au",
        id: "6768000000314751",
        name: "Riley",
      },
    ]);
  });

  it("matches MSP Central technicians by technician id first", () => {
    const [profile] = getInitialStaffProfiles();
    const result = findStaffForMspCentralTechnician(
      {
        email: "someone-else@egit.com.au",
        id: "msp-123",
        name: "Different Name",
      },
      [{ ...profile, mspCentralTechnicianId: "msp-123" }],
    );

    expect(result).toMatchObject({
      matchMethod: "msp_central_technician_id",
      profile: { id: profile.id },
      warning: undefined,
    });
  });

  it("matches MSP Central technician email against staff profile email", () => {
    const result = findStaffForMspCentralTechnician(
      {
        email: "JERVY@EGIT.COM.AU",
        name: "Jervy",
      },
      getInitialStaffProfiles(),
    );

    expect(result).toMatchObject({
      matchMethod: "msp_central_email",
      profile: { id: "staff-jervy" },
      warning: undefined,
    });
  });

  it("falls back from blank MSP Central email to Zoho email", () => {
    const [profile] = getInitialStaffProfiles();
    const result = findStaffForMspCentralTechnician(
      {
        email: "simeon@egit.com.au",
        name: "Simeon",
      },
      [{ ...profile, mspCentralEmail: "" }],
    );

    expect(result).toMatchObject({
      matchMethod: "zoho_email",
      profile: { id: "staff-simeon" },
      warning: undefined,
    });
  });

  it("does not allow display-name-only matching without a warning", () => {
    const result = findStaffForMspCentralTechnician(
      {
        name: "Riley",
      },
      getInitialStaffProfiles(),
    );

    expect(result).toMatchObject({
      matchMethod: "display_name",
      profile: { id: "staff-riley" },
      warning: "Display name match requires manual review.",
    });
  });
});

import type { Technician } from "@/server/dispatch/types";

export type StaffRole = "admin" | "technician";
export type StaffBaseOffice = "Bairnsdale" | "Sale";

export type StaffProfile = {
  id: string;
  displayName: string;
  role: StaffRole;
  baseOffice: StaffBaseOffice;
  zohoEmail: string;
  zohoPeopleEmployeeId?: string | null;
  outlookEmail: string;
  outlookUserPrincipalName: string;
  mspCentralEmail: string;
  mspCentralTechnicianId?: string | null;
  mspCentralTechnicianName?: string | null;
  active: boolean;
  dispatchEnabled: boolean;
  calendarEnabled: boolean;
};

export type MspCentralTechnicianIdentity = {
  id?: string | null;
  email?: string | null;
  name?: string | null;
};

export type StaffMatchMethod =
  | "msp_central_technician_id"
  | "msp_central_email"
  | "zoho_email"
  | "display_name"
  | "none";

export type StaffMatchResult = {
  matchMethod: StaffMatchMethod;
  profile?: StaffProfile;
  warning?: string;
};

const staffProfiles: StaffProfile[] = [
  {
    id: "staff-simeon",
    displayName: "Simeon",
    role: "admin",
    baseOffice: "Bairnsdale",
    zohoEmail: "simeon@egit.com.au",
    zohoPeopleEmployeeId: null,
    outlookEmail: "simeon@egit.com.au",
    outlookUserPrincipalName: "simeon@egit.com.au",
    mspCentralEmail: "simeon@egit.com.au",
    mspCentralTechnicianId: null,
    mspCentralTechnicianName: null,
    active: true,
    dispatchEnabled: true,
    calendarEnabled: true,
  },
  {
    id: "staff-matt",
    displayName: "Matt",
    role: "technician",
    baseOffice: "Sale",
    zohoEmail: "mattd@egit.com.au",
    zohoPeopleEmployeeId: null,
    outlookEmail: "mattd@egit.com.au",
    outlookUserPrincipalName: "mattd@egit.com.au",
    mspCentralEmail: "mattd@egit.com.au",
    mspCentralTechnicianId: null,
    mspCentralTechnicianName: null,
    active: true,
    dispatchEnabled: true,
    calendarEnabled: true,
  },
  {
    id: "staff-jervy",
    displayName: "Jervy",
    role: "technician",
    baseOffice: "Bairnsdale",
    zohoEmail: "jervy@egit.com.au",
    zohoPeopleEmployeeId: null,
    outlookEmail: "jervy@egit.com.au",
    outlookUserPrincipalName: "jervy@egit.com.au",
    mspCentralEmail: "jervy@egit.com.au",
    mspCentralTechnicianId: null,
    mspCentralTechnicianName: null,
    active: true,
    dispatchEnabled: true,
    calendarEnabled: true,
  },
  {
    id: "staff-riley",
    displayName: "Riley",
    role: "technician",
    baseOffice: "Bairnsdale",
    zohoEmail: "riley@egit.com.au",
    zohoPeopleEmployeeId: null,
    outlookEmail: "riley@egit.com.au",
    outlookUserPrincipalName: "riley@egit.com.au",
    mspCentralEmail: "riley@egit.com.au",
    mspCentralTechnicianId: null,
    mspCentralTechnicianName: null,
    active: true,
    dispatchEnabled: true,
    calendarEnabled: true,
  },
];

export function getInitialStaffProfiles(): StaffProfile[] {
  return staffProfiles.map((profile) => ({ ...profile }));
}

export function findStaffForZohoLogin(
  zohoEmail: string,
  profiles: StaffProfile[] = getInitialStaffProfiles(),
) {
  const email = normalizeEmail(zohoEmail);
  return profiles.find((profile) => normalizeEmail(profile.zohoEmail) === email);
}

export function isAdminStaffEmail(
  email: string,
  profiles: StaffProfile[] = getInitialStaffProfiles(),
) {
  return (
    profiles.find(
      (profile) => normalizeEmail(profile.zohoEmail) === normalizeEmail(email),
    )?.role === "admin"
  );
}

export function findStaffForMspCentralTechnician(
  technician: MspCentralTechnicianIdentity,
  profiles: StaffProfile[] = getInitialStaffProfiles(),
): StaffMatchResult {
  const technicianId = normalizeValue(technician.id);
  const technicianEmail = normalizeEmail(technician.email);
  const technicianName = normalizeValue(technician.name);

  if (technicianId) {
    const profile = profiles.find(
      (candidate) =>
        normalizeValue(candidate.mspCentralTechnicianId) === technicianId,
    );

    if (profile) {
      return {
        matchMethod: "msp_central_technician_id",
        profile,
        warning: undefined,
      };
    }
  }

  if (technicianEmail) {
    const profile = profiles.find(
      (candidate) =>
        normalizeEmail(candidate.mspCentralEmail) === technicianEmail,
    );

    if (profile) {
      return { matchMethod: "msp_central_email", profile, warning: undefined };
    }

    const fallbackProfile = profiles.find(
      (candidate) =>
        !normalizeEmail(candidate.mspCentralEmail) &&
        normalizeEmail(candidate.zohoEmail) === technicianEmail,
    );

    if (fallbackProfile) {
      return {
        matchMethod: "zoho_email",
        profile: fallbackProfile,
        warning: undefined,
      };
    }
  }

  if (technicianName) {
    const profile = profiles.find(
      (candidate) => normalizeValue(candidate.displayName) === technicianName,
    );

    if (profile) {
      return {
        matchMethod: "display_name",
        profile,
        warning: "Display name match requires manual review.",
      };
    }
  }

  return {
    matchMethod: "none",
    warning: "No staff profile matched the MSP Central technician.",
  };
}

export function staffProfileToTechnician(profile: StaffProfile): Technician {
  const baseOfficeId = profile.baseOffice === "Sale" ? "sale" : "bairnsdale";
  const baseOfficeAddress =
    baseOfficeId === "sale"
      ? "387 Raymond Street, Sale VIC 3850"
      : "137 Main Street, Bairnsdale VIC 3875";

  return {
    id: `tech-${profile.displayName.toLowerCase()}`,
    active: profile.active,
    baseOfficeAddress,
    baseOfficeId,
    baseOfficeName: profile.baseOffice,
    calendarEnabled: profile.calendarEnabled,
    displayName: profile.displayName,
    mappingStatus:
      profile.mspCentralEmail &&
      (profile.outlookUserPrincipalName || profile.outlookEmail)
        ? "mapped"
        : "missing-sdp",
    mspCentralEmail: profile.mspCentralEmail,
    mspCentralTechnicianId: profile.mspCentralTechnicianId,
    mspCentralTechnicianName: profile.mspCentralTechnicianName,
    outlookEmail: profile.outlookEmail,
    outlookUserPrincipalName: profile.outlookUserPrincipalName,
    role: profile.role,
    sdpTechnicianName: profile.mspCentralTechnicianName ?? undefined,
    storeLocation: profile.baseOffice,
    zohoEmail: profile.zohoEmail,
    zohoPeopleEmployeeId: profile.zohoPeopleEmployeeId,
  };
}

function normalizeEmail(value?: string | null) {
  return normalizeValue(value);
}

function normalizeValue(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

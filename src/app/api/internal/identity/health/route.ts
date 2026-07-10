import { NextResponse } from "next/server";

import { getCommandCentreAccess } from "@/server/auth/session";
import {
  findStaffForZohoLogin,
  getInitialStaffProfiles,
} from "@/server/staff/profiles";

export async function GET() {
  const access = await getCommandCentreAccess();

  if (access.status === "unauthenticated") {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  if (access.status === "not-approved") {
    return NextResponse.json({ error: "Access not approved." }, { status: 403 });
  }

  const profiles = getInitialStaffProfiles();
  const signedInEmail = access.email;
  const matchedProfile = signedInEmail
    ? findStaffForZohoLogin(signedInEmail, profiles)
    : undefined;

  return NextResponse.json({
    matchingRules: [
      "Command Centre login uses zohoEmail.",
      "Outlook calendar matching uses outlookUserPrincipalName/outlookEmail.",
      "MSP Central matching prefers technician ID, then MSP email, then Zoho email, then display-name warning.",
    ],
    signedIn: {
      email: signedInEmail,
      matchedStaffProfile: matchedProfile
        ? {
            active: matchedProfile.active,
            baseOffice: matchedProfile.baseOffice,
            calendarEnabled: matchedProfile.calendarEnabled,
            dispatchEnabled: matchedProfile.dispatchEnabled,
            displayName: matchedProfile.displayName,
            hasMspCentralEmail: Boolean(matchedProfile.mspCentralEmail),
            hasMspCentralTechnicianId: Boolean(
              matchedProfile.mspCentralTechnicianId,
            ),
            hasOutlookEmail: Boolean(
              matchedProfile.outlookEmail ||
                matchedProfile.outlookUserPrincipalName,
            ),
            id: matchedProfile.id,
            role: matchedProfile.role,
          }
        : undefined,
    },
    ok: true,
    staff: profiles.map((profile) => ({
      active: profile.active,
      baseOffice: profile.baseOffice,
      calendarEnabled: profile.calendarEnabled,
      dispatchEnabled: profile.dispatchEnabled,
      displayName: profile.displayName,
      hasMspCentralEmail: Boolean(profile.mspCentralEmail),
      hasMspCentralTechnicianId: Boolean(profile.mspCentralTechnicianId),
      hasOutlookEmail: Boolean(
        profile.outlookEmail || profile.outlookUserPrincipalName,
      ),
      id: profile.id,
      role: profile.role,
    })),
    staffCount: profiles.length,
  });
}

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { buildMspCentralAuthorizationUrl } from "@/server/msp-central/oauth";
import { isAdminStaffEmail } from "@/server/staff/profiles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const access = await getCommandCentreAccess();
  if (!isApprovedStaffAccess(access)) {
    return NextResponse.json(
      { error: access.status === "unauthenticated" ? "Sign in required." : "Access not approved." },
      { status: access.status === "unauthenticated" ? 401 : 403 },
    );
  }
  if (!isAdminStaffEmail(access.email)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const appBaseUrl = cleanUrl(process.env.APP_BASE_URL);
  const clientId = process.env.MSP_CENTRAL_CLIENT_ID?.trim();
  if (!appBaseUrl || !clientId) {
    return NextResponse.json(
      { error: "MSP Central OAuth is not configured." },
      { status: 503 },
    );
  }

  const state = randomUUID();
  const redirectUri = `${appBaseUrl}/api/internal/msp-central/oauth/callback`;
  const response = NextResponse.redirect(
    buildMspCentralAuthorizationUrl({
      accountsUrl:
        cleanUrl(process.env.MSP_CENTRAL_ACCOUNTS_URL) ??
        "https://accounts.zoho.com.au",
      clientId,
      redirectUri,
      state,
    }),
  );
  response.cookies.set("msp_oauth_state", state, {
    httpOnly: true,
    maxAge: 10 * 60,
    path: "/api/internal/msp-central/oauth/callback",
    sameSite: "lax",
    secure: appBaseUrl.startsWith("https://"),
  });
  return response;
}

function cleanUrl(value?: string) {
  const clean = value?.trim().replace(/\/+$/, "");
  return clean || undefined;
}

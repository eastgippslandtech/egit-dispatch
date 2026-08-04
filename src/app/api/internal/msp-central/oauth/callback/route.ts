import { NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { resetMspCentralAccessTokenCacheForTests } from "@/server/msp-central/client";
import { getConfiguredMspOAuthCredentialStore } from "@/server/msp-central/credential-store";
import { exchangeMspCentralAuthorizationCode } from "@/server/msp-central/oauth";
import { isAdminStaffEmail } from "@/server/staff/profiles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const expectedState = readCookie(request.headers.get("cookie"), "msp_oauth_state");
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.json({ error: "OAuth callback validation failed." }, { status: 400 });
  }

  const appBaseUrl = cleanUrl(process.env.APP_BASE_URL);
  const accountsUrl =
    cleanUrl(process.env.MSP_CENTRAL_ACCOUNTS_URL) ??
    "https://accounts.zoho.com.au";
  const clientId = process.env.MSP_CENTRAL_CLIENT_ID?.trim();
  const clientSecret = process.env.MSP_CENTRAL_CLIENT_SECRET?.trim();
  const credentialStore = getConfiguredMspOAuthCredentialStore();
  if (!appBaseUrl || !clientId || !clientSecret || !credentialStore) {
    return NextResponse.json(
      { error: "MSP Central OAuth storage is not configured." },
      { status: 503 },
    );
  }

  try {
    const credential = await exchangeMspCentralAuthorizationCode({
      accountsUrl,
      clientId,
      clientSecret,
      code,
      redirectUri: `${appBaseUrl}/api/internal/msp-central/oauth/callback`,
    });
    await credentialStore.saveCredential({
      apiDomain: credential.apiDomain,
      refreshToken: credential.refreshToken,
      updatedBy: access.email,
    });
    resetMspCentralAccessTokenCacheForTests();

    const response = NextResponse.redirect(`${appBaseUrl}/integrations?msp=connected`);
    response.cookies.delete("msp_oauth_state");
    return response;
  } catch {
    return NextResponse.redirect(`${appBaseUrl}/integrations?msp=error`);
  }
}

function readCookie(header: string | null, name: string) {
  for (const item of header?.split(";") ?? []) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) {
      return decodeURIComponent(value.join("="));
    }
  }
  return undefined;
}

function cleanUrl(value?: string) {
  const clean = value?.trim().replace(/\/+$/, "");
  return clean || undefined;
}

import { findStaffForZohoLogin, getInitialStaffProfiles } from "@/server/staff/profiles";

const DEFAULT_MOBILE_ALLOWLIST = getInitialStaffProfiles()
  .filter((profile) => profile.active && profile.dispatchEnabled)
  .map((profile) => profile.zohoEmail.toLowerCase());

export interface ExchangeMobileLoginInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export type ExchangeMobileLoginResult =
  | {
      email: string;
      status: "not-approved";
    }
  | {
      email: string;
      session: {
        accessToken: string;
        expiresAt: string;
        refreshToken: string;
      };
      staffId: string;
      status: "approved";
    };

export async function exchangeMobileLogin({
  code,
}: ExchangeMobileLoginInput): Promise<ExchangeMobileLoginResult> {
  const email = emailFromMockZohoCode(code);
  const normalizedEmail = email.toLowerCase();

  if (!DEFAULT_MOBILE_ALLOWLIST.includes(normalizedEmail)) {
    return {
      email,
      status: "not-approved",
    };
  }

  const staff = findStaffForZohoLogin(normalizedEmail);
  if (!staff) {
    return {
      email,
      status: "not-approved",
    };
  }

  return {
    email,
    session: {
      accessToken: `mobile-access-${staff.id}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      refreshToken: `mobile-refresh-${staff.id}`,
    },
    staffId: staff.id,
    status: "approved",
  };
}

export async function refreshMobileSession(refreshToken: string) {
  if (!refreshToken.startsWith("mobile-refresh-")) {
    return { status: "invalid" as const };
  }

  return {
    accessToken: refreshToken.replace("mobile-refresh-", "mobile-access-"),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    status: "refreshed" as const,
  };
}

export async function revokeMobileSession(refreshToken: string) {
  void refreshToken;
  return { status: "revoked" as const };
}

function emailFromMockZohoCode(code: string): string {
  if (code.startsWith("code-")) {
    return code.slice("code-".length).trim().toLowerCase();
  }

  return code.trim().toLowerCase();
}

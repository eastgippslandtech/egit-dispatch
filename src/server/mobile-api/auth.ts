import { createHmac, timingSafeEqual } from "node:crypto";

import type { MobileStaff } from "../../../apps/technician-mobile/src/contracts/mobile";
import {
  cloneMobileFixture,
  MOBILE_STAFF_FIXTURES,
} from "../../../apps/technician-mobile/src/testing/fixtures";
import {
  findStaffForZohoLogin,
  getInitialStaffProfiles,
} from "@/server/staff/profiles";

import type { MobileAuthContext } from "./contracts";

const DEFAULT_MOBILE_ALLOWLIST = getInitialStaffProfiles()
  .filter((profile) => profile.active && profile.dispatchEnabled)
  .map((profile) => profile.zohoEmail.toLowerCase());
const DEFAULT_ZOHO_ACCOUNTS_URL = "https://accounts.zoho.com.au";
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface ExchangeMobileLoginInput {
  accountsServer?: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

interface ZohoTokenResponse {
  accessToken: string;
  accountsServer?: string;
  expiresIn: number;
}

interface ZohoProfile {
  email: string;
}

interface ExchangeMobileLoginDependencies {
  exchangeZohoCode?: (
    input: ExchangeMobileLoginInput,
  ) => Promise<ZohoTokenResponse>;
  fetchZohoProfile?: (
    accessToken: string,
    accountsServer?: string,
  ) => Promise<ZohoProfile>;
  now?: () => Date;
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
      staff: MobileStaff;
      staffId: string;
      status: "approved";
    };

export async function exchangeMobileLogin({
  code,
  codeVerifier,
  redirectUri,
  accountsServer,
}: ExchangeMobileLoginInput,
dependencies: ExchangeMobileLoginDependencies = {},
): Promise<ExchangeMobileLoginResult> {
  const now = dependencies.now?.() ?? new Date();
  const zohoTokens = await (dependencies.exchangeZohoCode ?? exchangeZohoCode)({
    accountsServer,
    code,
    codeVerifier,
    redirectUri,
  });
  const profile = await (dependencies.fetchZohoProfile ?? fetchZohoProfile)(
    zohoTokens.accessToken,
    zohoTokens.accountsServer ?? accountsServer,
  );
  const email = profile.email.trim().toLowerCase();
  const normalizedEmail = email.toLowerCase();

  if (!DEFAULT_MOBILE_ALLOWLIST.includes(normalizedEmail)) {
    return {
      email,
      status: "not-approved",
    };
  }

  const staffProfile = findStaffForZohoLogin(normalizedEmail);
  const staff = mobileStaffForZohoEmail(normalizedEmail);
  if (!staffProfile || !staff) {
    return {
      email,
      status: "not-approved",
    };
  }

  const session = createMobileSessionTokens({
    email: normalizedEmail,
    now,
    staffId: staffProfile.id,
  });

  return {
    email,
    session,
    staff,
    staffId: staffProfile.id,
    status: "approved",
  };
}

export async function refreshMobileSession(
  refreshToken: string,
  { now = () => new Date() }: { now?: () => Date } = {},
) {
  const payload = verifyMobileSessionToken(refreshToken, "refresh", now());
  if (!payload) {
    return { status: "invalid" as const };
  }

  return {
    ...createMobileSessionTokens({
      email: payload.email,
      now: now(),
      staffId: payload.staffId,
    }),
    status: "refreshed" as const,
  };
}

export async function revokeMobileSession(refreshToken: string) {
  void refreshToken;
  return { status: "revoked" as const };
}

export function createMobileSessionTokens({
  email,
  now,
  staffId,
}: {
  email: string;
  now: Date;
  staffId: string;
}) {
  return {
    accessToken: signMobileSessionToken({
      email,
      expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString(),
      staffId,
      type: "access",
    }),
    expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString(),
    refreshToken: signMobileSessionToken({
      email,
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS).toISOString(),
      staffId,
      type: "refresh",
    }),
  };
}

export function requireMobileAuth(
  request: Request,
  { now = () => new Date() }: { now?: () => Date } = {},
): MobileAuthContext {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw Object.assign(new Error("Mobile bearer token is required."), {
      code: "UNAUTHORIZED",
      status: 401,
    });
  }

  const payload = verifyMobileSessionToken(token, "access", now());
  if (!payload) {
    throw Object.assign(new Error("Mobile bearer token is invalid."), {
      code: "UNAUTHORIZED",
      status: 401,
    });
  }

  return {
    email: payload.email,
    staffId: payload.staffId,
  };
}

async function exchangeZohoCode({
  accountsServer,
  code,
  codeVerifier,
  redirectUri,
}: ExchangeMobileLoginInput): Promise<ZohoTokenResponse> {
  const clientId = process.env.ZOHO_CLIENT_ID ?? process.env.AUTH_ZOHO_ID;
  const clientSecret =
    process.env.ZOHO_CLIENT_SECRET ?? process.env.AUTH_ZOHO_SECRET;
  if (!clientId || !clientSecret) {
    throw Object.assign(new Error("Zoho mobile auth is not configured."), {
      code: "BAD_REQUEST",
      status: 500,
    });
  }

  const tokenEndpoint = `${
    accountsServer ?? process.env.ZOHO_ACCOUNTS_URL ?? DEFAULT_ZOHO_ACCOUNTS_URL
  }/oauth/v2/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const response = await fetch(tokenEndpoint, {
    body,
    headers: { Accept: "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw Object.assign(new Error("Zoho authorization code exchange failed."), {
      code: "UNAUTHORIZED",
      status: 401,
    });
  }

  const json = (await response.json()) as {
    access_token?: string;
    api_domain?: string;
    expires_in?: number;
  };
  if (!json.access_token) {
    throw Object.assign(new Error("Zoho did not return an access token."), {
      code: "UNAUTHORIZED",
      status: 401,
    });
  }

  return {
    accessToken: json.access_token,
    accountsServer,
    expiresIn: json.expires_in ?? 3600,
  };
}

async function fetchZohoProfile(
  accessToken: string,
  accountsServer = process.env.ZOHO_ACCOUNTS_URL ?? DEFAULT_ZOHO_ACCOUNTS_URL,
): Promise<ZohoProfile> {
  const response = await fetch(`${accountsServer}/oauth/user/info`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    throw Object.assign(new Error("Zoho profile lookup failed."), {
      code: "UNAUTHORIZED",
      status: 401,
    });
  }

  const profile = (await response.json()) as {
    Email?: string;
    email?: string;
  };
  const email = profile.Email ?? profile.email;
  if (!email) {
    throw Object.assign(new Error("Zoho profile did not include an email."), {
      code: "UNAUTHORIZED",
      status: 401,
    });
  }

  return { email };
}

type SessionTokenType = "access" | "refresh";

interface MobileSessionTokenPayload {
  email: string;
  expiresAt: string;
  staffId: string;
  type: SessionTokenType;
}

function signMobileSessionToken(payload: MobileSessionTokenPayload): string {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `ccm1.${encodedPayload}.${signature}`;
}

function verifyMobileSessionToken(
  token: string,
  expectedType: SessionTokenType,
  now: Date,
): MobileSessionTokenPayload | null {
  const [version, encodedPayload, signature] = token.split(".");
  if (version !== "ccm1" || !encodedPayload || !signature) {
    return null;
  }
  if (!safeEqual(signature, sign(encodedPayload))) {
    return null;
  }

  const payload = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8"),
  ) as MobileSessionTokenPayload;
  if (payload.type !== expectedType || new Date(payload.expiresAt) <= now) {
    return null;
  }

  return payload;
}

function sign(value: string): string {
  return createHmac("sha256", getMobileSessionSecret())
    .update(value)
    .digest("base64url");
}

function getMobileSessionSecret(): string {
  const secret =
    process.env.MOBILE_SESSION_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET;
  if (secret) {
    return secret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("MOBILE_SESSION_SECRET or AUTH_SECRET is required.");
  }
  return "command-centre-local-mobile-session-secret";
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function mobileStaffForZohoEmail(email: string): MobileStaff | null {
  const staff = MOBILE_STAFF_FIXTURES.find(
    (candidate) => candidate.zohoEmail.toLowerCase() === email.toLowerCase(),
  );
  return staff ? cloneMobileFixture(staff) : null;
}

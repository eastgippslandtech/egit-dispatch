import { getMobileRuntimeConfig } from "../config/runtime";

import type { MobileSession } from "./session-store";

const REFRESH_SAFETY_WINDOW_MS = 5 * 60 * 1000;

interface RefreshMobileSessionOptions {
  fetcher?: typeof fetch;
  now?: () => Date;
}

interface RefreshMobileSessionEnvelope {
  data?: {
    accessToken?: string;
    expiresAt?: string;
    refreshToken?: string;
    status?: string;
  };
}

export function isMobileSessionExpiring(
  session: MobileSession,
  { now = () => new Date() }: Pick<RefreshMobileSessionOptions, "now"> = {},
) {
  return (
    Date.parse(session.expiresAt) - now().getTime() <= REFRESH_SAFETY_WINDOW_MS
  );
}

export async function refreshMobileSession(
  session: MobileSession,
  { fetcher = fetch, now = () => new Date() }: RefreshMobileSessionOptions = {},
): Promise<MobileSession | null> {
  if (!isMobileSessionExpiring(session, { now })) {
    return session;
  }

  const config = getMobileRuntimeConfig();
  const response = await fetcher(`${config.mobileApiBaseUrl}/auth/refresh`, {
    body: JSON.stringify({ refreshToken: session.refreshToken }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    return null;
  }

  const envelope = (await response.json()) as RefreshMobileSessionEnvelope;
  const refreshed = envelope.data;
  if (
    refreshed?.status !== "refreshed" ||
    !refreshed.accessToken ||
    !refreshed.expiresAt ||
    !refreshed.refreshToken
  ) {
    return null;
  }

  return {
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
    refreshToken: refreshed.refreshToken,
    staffEmail: session.staffEmail,
  };
}

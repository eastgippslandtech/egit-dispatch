import { timingSafeEqual } from "node:crypto";

import { getCommandCentreAccess, isApprovedStaffAccess } from "@/server/auth/session";
import {
  findStaffForZohoLogin,
  isAdminStaffEmail,
} from "@/server/staff/profiles";

export function cronAuthorized(request: Request) {
  const secret =
    process.env.INTEGRATION_CRON_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization) return false;

  const actual = Buffer.from(authorization, "utf8");
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  if (actual.length !== expected.length) return false;

  return timingSafeEqual(actual, expected);
}

export async function staffRouteAccess() {
  const access = await getCommandCentreAccess();
  return isApprovedStaffAccess(access) ? access : null;
}

export async function adminRouteAccess() {
  const access = await staffRouteAccess();
  return access && isAdminStaffEmail(access.email) ? access : null;
}

export async function dispatchRouteAccess() {
  const access = await staffRouteAccess();
  if (!access?.email) return null;
  return canManageIntegrationRecovery(access.email)
    ? access
    : null;
}

export function canManageIntegrationRecovery(email: string) {
  const profile = findStaffForZohoLogin(email);
  return Boolean(profile?.dispatchEnabled || isAdminStaffEmail(email));
}

import { getCommandCentreAccess, isApprovedStaffAccess } from "@/server/auth/session";
import {
  findStaffForZohoLogin,
  isAdminStaffEmail,
} from "@/server/staff/profiles";

export function cronAuthorized(request: Request) {
  const secret =
    process.env.INTEGRATION_CRON_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
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
  const profile = findStaffForZohoLogin(access.email);
  return profile?.dispatchEnabled || isAdminStaffEmail(access.email)
    ? access
    : null;
}

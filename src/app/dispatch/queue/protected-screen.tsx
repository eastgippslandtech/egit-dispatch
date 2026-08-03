import { redirect } from "next/navigation";

import { AccessNotApproved } from "@/app/auth/auth-screen";
import { getCommandCentreAccess, isApprovedStaffAccess } from "@/server/auth/session";
import { getTestSyncedDispatchDashboardData } from "@/server/dispatch/test-sync-dashboard";
import {
  findStaffForZohoLogin,
  isAdminStaffEmail,
  staffProfileToTechnician,
} from "@/server/staff/profiles";

import { DispatchQueueScreen } from "./queue-screen";

export async function ProtectedDispatchQueueScreen() {
  const access = await getCommandCentreAccess();

  if (access.status === "unauthenticated") {
    redirect("/auth/sign-in?callbackUrl=/dispatch/queue");
  }
  if (access.status === "wallboard-only") {
    redirect("/wallboard");
  }
  if (!isApprovedStaffAccess(access)) {
    return <AccessNotApproved email={access.email} name={access.name} />;
  }

  const data = await getTestSyncedDispatchDashboardData();
  const profile = findStaffForZohoLogin(access.email);
  const canManageIntegrations = Boolean(
    access.authDisabled || profile?.dispatchEnabled || isAdminStaffEmail(access.email),
  );

  return (
    <DispatchQueueScreen
      authDisabled={Boolean(access.authDisabled)}
      currentTechnicianId={profile ? staffProfileToTechnician(profile).id : undefined}
      data={data}
      showIntegrations={canManageIntegrations}
    />
  );
}

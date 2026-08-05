import { redirect } from "next/navigation";

import { AccessNotApproved } from "@/app/auth/auth-screen";
import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { getTestSyncedDispatchDashboardData } from "@/server/dispatch/test-sync-dashboard";
import {
  findStaffForZohoLogin,
  isAdminStaffEmail,
} from "@/server/staff/profiles";

import { CommandCentrePrototype } from "./prototype";

export async function ProtectedCommandCentreScreen({
  selectedRequestId,
}: {
  selectedRequestId?: string;
} = {}) {
  const access = await getCommandCentreAccess();

  if (access.status === "unauthenticated") {
    redirect("/auth/sign-in?callbackUrl=/dispatch");
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
  const requestedSelection = selectedRequestId
    ? data.requests.find((request) => request.id === selectedRequestId)
    : undefined;
  const selectedData = requestedSelection
    ? { ...data, selectedRequestId: requestedSelection.id }
    : data;

  return (
    <CommandCentrePrototype
      authDisabled={access.authDisabled}
      data={selectedData}
      showIntegrationStatus
      showIntegrations={canManageIntegrations}
      key={data.dispatchDataSource}
    />
  );
}

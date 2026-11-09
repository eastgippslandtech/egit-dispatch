import { redirect } from "next/navigation";

import { AccessNotApproved } from "@/app/auth/auth-screen";
import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { getTestSyncedDispatchDashboardData } from "@/server/dispatch/test-sync-dashboard";
import { getConfiguredRequestNicknameRepository } from "@/server/dispatch/request-nickname-repository";
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
  let nicknames: Record<string, string> = {};
  const nicknameRepository = getConfiguredRequestNicknameRepository();
  if (nicknameRepository) {
    try {
      nicknames = await nicknameRepository.list(data.requests.map((request) => request.id));
    } catch (error) {
      console.error("Ticket nicknames could not be loaded", error);
    }
  }
  const requests = data.requests.map((request) => ({
    ...request,
    nickname: nicknames[request.id],
  }));
  const profile = findStaffForZohoLogin(access.email);
  const canManageIntegrations = Boolean(
    access.authDisabled || profile?.dispatchEnabled || isAdminStaffEmail(access.email),
  );
  const requestedSelection = selectedRequestId
    ? requests.find((request) => request.id === selectedRequestId)
    : undefined;
  const selectedData = requestedSelection
    ? { ...data, requests, selectedRequestId: requestedSelection.id }
    : { ...data, requests };

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

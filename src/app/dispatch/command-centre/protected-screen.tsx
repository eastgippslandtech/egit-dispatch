import { redirect } from "next/navigation";

import { AccessNotApproved } from "@/app/auth/auth-screen";
import { getCommandCentreAccess } from "@/server/auth/session";
import { getTestSyncedDispatchDashboardData } from "@/server/dispatch/test-sync-dashboard";

import { CommandCentrePrototype } from "./prototype";

export async function ProtectedCommandCentreScreen() {
  const access = await getCommandCentreAccess();

  if (access.status === "unauthenticated") {
    redirect("/auth/sign-in?callbackUrl=/dispatch");
  }

  if (access.status === "not-approved") {
    return <AccessNotApproved email={access.email} name={access.name} />;
  }

  const data = await getTestSyncedDispatchDashboardData();

  return <CommandCentrePrototype authDisabled={access.authDisabled} data={data} />;
}

import { redirect } from "next/navigation";

import { AccessNotApproved } from "@/app/auth/auth-screen";
import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import {
  findStaffForZohoLogin,
  isAdminStaffEmail,
} from "@/server/staff/profiles";

import { IntegrationsConsole } from "./screen";

export default async function IntegrationsPage() {
  const access = await getCommandCentreAccess();
  if (access.status === "unauthenticated") {
    redirect("/auth/sign-in?callbackUrl=/integrations");
  }
  if (access.status === "wallboard-only") {
    redirect("/wallboard");
  }
  if (!isApprovedStaffAccess(access)) {
    return <AccessNotApproved email={access.email} name={access.name} />;
  }

  const profile = findStaffForZohoLogin(access.email);
  if (
    !access.authDisabled &&
    !profile?.dispatchEnabled &&
    !isAdminStaffEmail(access.email)
  ) {
    return <AccessNotApproved email={access.email} name={access.name} />;
  }

  return <IntegrationsConsole />;
}

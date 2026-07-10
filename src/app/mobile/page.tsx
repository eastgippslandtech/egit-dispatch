import { redirect } from "next/navigation";

import { AccessNotApproved } from "@/app/auth/auth-screen";
import { getCommandCentreAccess } from "@/server/auth/session";
import {
  getMobilePageData,
  resolveStaffProfileForMobile,
} from "@/server/mobile/services";

import { CommandCentreMobileApp } from "./mobile-app";

export default async function MobilePage() {
  const access = await getCommandCentreAccess();

  if (access.status === "unauthenticated") {
    redirect("/auth/sign-in?callbackUrl=/mobile");
  }

  if (access.status === "not-approved") {
    return <AccessNotApproved email={access.email} name={access.name} />;
  }

  const staff = resolveStaffProfileForMobile(access);

  if (!staff) {
    return <AccessNotApproved email={access.email} name={access.name} />;
  }

  return <CommandCentreMobileApp data={getMobilePageData({ zohoEmail: staff.zohoEmail })} />;
}

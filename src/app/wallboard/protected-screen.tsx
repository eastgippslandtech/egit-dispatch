import { redirect } from "next/navigation";

import { AccessNotApproved } from "@/app/auth/auth-screen";
import { getCommandCentreAccess } from "@/server/auth/session";
import { getWallboardSnapshot } from "@/server/presence/service";
import { WallboardScreen } from "./wallboard-screen";

export async function ProtectedWallboardScreen() {
  const access = await getCommandCentreAccess();

  if (access.status === "unauthenticated") {
    redirect("/auth/sign-in?callbackUrl=/wallboard");
  }

  if (access.status === "not-approved") {
    return <AccessNotApproved email={access.email} name={access.name} />;
  }

  return (
    <WallboardScreen
      authDisabled={access.authDisabled}
      initialSnapshot={await getWallboardSnapshot()}
    />
  );
}

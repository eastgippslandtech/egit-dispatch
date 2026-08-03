import { redirect } from "next/navigation";

import { AccessNotApproved } from "@/app/auth/auth-screen";
import { getWallboardAccess } from "@/server/auth/session";
import { getWallboardSnapshot } from "@/server/presence/service";
import { getDeploymentVersion } from "./deployment-version";
import { WallboardScreen } from "./wallboard-screen";

export async function ProtectedWallboardScreen() {
  const access = await getWallboardAccess();

  if (access.status === "unauthenticated") {
    redirect("/auth/wallboard-sign-in");
  }

  if (access.status === "not-approved") {
    return <AccessNotApproved email={access.email} name={access.name} />;
  }

  return (
    <WallboardScreen
      authDisabled={
        access.accessLevel === "staff" ? access.authDisabled : undefined
      }
      canAccessDispatch={access.accessLevel === "staff"}
      deploymentVersion={getDeploymentVersion()}
      initialSnapshot={await getWallboardSnapshot()}
    />
  );
}

import { NextResponse } from "next/server";

import { getCommandCentreAccess } from "@/server/auth/session";
import { getMspCentralReadinessStatus } from "@/server/msp-central/health";

export async function GET() {
  const access = await getCommandCentreAccess();

  if (access.status === "unauthenticated") {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  if (access.status === "not-approved") {
    return NextResponse.json({ error: "Access not approved." }, { status: 403 });
  }

  const status = getMspCentralReadinessStatus();

  return NextResponse.json(status, {
    status: status.ok ? 200 : 503,
  });
}

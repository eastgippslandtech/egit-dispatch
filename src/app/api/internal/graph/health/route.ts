import { NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { getGraphHealthStatus } from "@/server/graph/health";

export async function GET() {
  const access = await getCommandCentreAccess();

  if (access.status === "unauthenticated") {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  if (!isApprovedStaffAccess(access)) {
    return NextResponse.json({ error: "Access not approved." }, { status: 403 });
  }

  const status = await getGraphHealthStatus();

  return NextResponse.json(status, {
    status: status.ok ? 200 : 503,
  });
}

import { NextResponse } from "next/server";

import { getConfiguredYeastarRepository } from "@/server/yeastar/repository";
import { staffRouteAccess } from "@/server/yeastar/route-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await staffRouteAccess())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const repository = getConfiguredYeastarRepository();
  return NextResponse.json({ calls: repository ? await repository.listCalls() : [] });
}

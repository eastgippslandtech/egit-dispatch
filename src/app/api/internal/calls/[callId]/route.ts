import { NextResponse } from "next/server";

import { getConfiguredYeastarRepository } from "@/server/yeastar/repository";
import { staffRouteAccess } from "@/server/yeastar/route-auth";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ callId: string }> },
) {
  if (!(await staffRouteAccess())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const repository = getConfiguredYeastarRepository();
  const call = repository ? await repository.getCall((await params).callId) : undefined;
  return call
    ? NextResponse.json(call)
    : NextResponse.json({ error: "Call not found." }, { status: 404 });
}

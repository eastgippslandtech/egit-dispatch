import { NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { normalizeRequestNickname } from "@/server/dispatch/request-nickname";
import { getConfiguredRequestNicknameRepository } from "@/server/dispatch/request-nickname-repository";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function PUT(request: Request, { params }: RouteContext) {
  const access = await getCommandCentreAccess();
  if (access.status === "unauthenticated") {
    return json({ error: "Authentication required." }, 401);
  }
  if (!isApprovedStaffAccess(access)) {
    return json({ error: "Access not approved." }, 403);
  }

  const repository = getConfiguredRequestNicknameRepository();
  if (!repository) return json({ error: "Ticket nicknames are unavailable." }, 503);

  const { requestId } = await params;
  if (!requestId || requestId.length > 128) {
    return json({ error: "Invalid ticket ID." }, 400);
  }

  let nickname: string | null;
  try {
    const body = await request.json() as Record<string, unknown>;
    nickname = normalizeRequestNickname(body.nickname);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid nickname." }, 400);
  }

  try {
    await repository.set(requestId, nickname, access.email);
    return json({ nickname }, 200);
  } catch (error) {
    console.error("Ticket nickname save failed", error);
    return json({ error: "Ticket nickname could not be saved." }, 500);
  }
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

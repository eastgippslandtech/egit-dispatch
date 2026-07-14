import { NextResponse } from "next/server";

import { getCommandCentreAccess } from "@/server/auth/session";
import {
  clearDispatchTestSyncEvents,
  listDispatchTestSyncEvents,
  normaliseDispatchTestSyncEvent,
  recordDispatchTestSyncEvent,
  type DispatchTestSyncEventInput,
} from "@/server/dispatch/test-sync";

export async function GET() {
  const access = await getApprovedAccess();

  if (access instanceof Response) {
    return access;
  }

  try {
    return noStoreJson({
      events: await listDispatchTestSyncEvents(),
      ok: true,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const access = await getApprovedAccess();

  if (access instanceof Response) {
    return access;
  }

  try {
    const body = (await request.json()) as DispatchTestSyncEventInput;
    normaliseDispatchTestSyncEvent(body);
    const event = await recordDispatchTestSyncEvent(body, access.email);

    return noStoreJson({ event, ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE() {
  const access = await getApprovedAccess();

  if (access instanceof Response) {
    return access;
  }

  try {
    await clearDispatchTestSyncEvents();
    return noStoreJson({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

async function getApprovedAccess() {
  const access = await getCommandCentreAccess();

  if (access.status === "unauthenticated") {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  if (access.status === "not-approved") {
    return NextResponse.json({ error: "Access not approved." }, { status: 403 });
  }

  return access;
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...init?.headers,
    },
  });
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Test sync failed.";

  console.error("Dispatch test sync route failed", error);

  return noStoreJson({ error: message, ok: false }, { status: 400 });
}

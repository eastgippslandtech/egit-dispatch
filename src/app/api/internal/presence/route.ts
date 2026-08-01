import { NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  getWallboardAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { getConfiguredPresenceOverrideRepository } from "@/server/presence/repository";
import { getWallboardSnapshot } from "@/server/presence/service";

export async function GET() {
  const access = await approvedWallboardAccess();
  if (access instanceof Response) return access;

  try {
    return noStoreJson(await getWallboardSnapshot());
  } catch (error) {
    return presenceError(error, 503);
  }
}

export async function POST(request: Request) {
  const access = await approvedStaffAccess();
  if (access instanceof Response) return access;

  try {
    const body = (await request.json()) as {
      action?: "clear" | "set_leave" | "start_lunch";
      endsAt?: string;
      reason?: string;
      technicianId?: string;
    };
    const snapshot = await getWallboardSnapshot();
    const technician = snapshot.dashboard.technicians.find(
      (candidate) =>
        candidate.active && candidate.id === body.technicianId,
    );
    if (!technician) {
      throw new Error("Technician is not enabled for Command Centre presence.");
    }
    const technicianEmail =
      technician.zohoEmail ?? technician.outlookEmail;
    const repository = getConfiguredPresenceOverrideRepository();
    if (!repository) {
      throw new Error("Presence persistence is not configured.");
    }

    if (body.action === "start_lunch") {
      const override = await repository.startLunch({
        createdByEmail: access.email,
        source: "dispatch",
        technicianEmail,
      });
      return noStoreJson({ ok: true, override });
    }

    if (body.action === "set_leave") {
      if (!body.endsAt) {
        throw new Error("Leave end date and time is required.");
      }
      const override = await repository.setLeave({
        createdByEmail: access.email,
        endsAt: body.endsAt,
        reason: body.reason,
        source: "dispatch",
        technicianEmail,
      });
      return noStoreJson({ ok: true, override });
    }

    if (body.action === "clear") {
      await repository.clear({ technicianEmail });
      return noStoreJson({ ok: true });
    }

    throw new Error("Unknown presence action.");
  } catch (error) {
    return presenceError(error, 400);
  }
}

async function approvedWallboardAccess() {
  const access = await getWallboardAccess();
  if (access.status === "unauthenticated") {
    return noStoreJson({ error: "Authentication required." }, { status: 401 });
  }
  if (access.status !== "approved") {
    return noStoreJson({ error: "Access not approved." }, { status: 403 });
  }
  return access;
}

async function approvedStaffAccess() {
  const access = await getCommandCentreAccess();
  if (access.status === "unauthenticated") {
    return noStoreJson({ error: "Authentication required." }, { status: 401 });
  }
  if (!isApprovedStaffAccess(access)) {
    return noStoreJson({ error: "Access not approved." }, { status: 403 });
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

function presenceError(error: unknown, status: number) {
  const message =
    error instanceof Error ? error.message : "Presence request failed.";
  console.error("Presence route failed", { message });
  return noStoreJson({ error: message, ok: false }, { status });
}

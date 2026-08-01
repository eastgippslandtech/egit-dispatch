import { requireMobileAuth } from "@/server/mobile-api/auth";
import { mobileError, mobileOk } from "@/server/mobile-api/responses";
import { getConfiguredPresenceOverrideRepository } from "@/server/presence/repository";
import { getWallboardSnapshot } from "@/server/presence/service";

export async function GET(request: Request) {
  try {
    const auth = requireMobileAuth(request);
    const snapshot = await getWallboardSnapshot();
    const technician = technicianForEmail(snapshot, auth.email);
    if (!technician) {
      return mobileError(
        404,
        "NOT_FOUND",
        "Technician presence profile was not found.",
      );
    }

    return mobileOk({
      peopleStatus: snapshot.peopleStatus,
      presence: snapshot.presences.find(
        (presence) => presence.technicianId === technician.id,
      ),
      updatedAt: snapshot.updatedAt,
    });
  } catch (error) {
    return mobileError(
      401,
      "UNAUTHORIZED",
      error instanceof Error ? error.message : "Mobile bearer token is invalid.",
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = requireMobileAuth(request);
    const body = (await request.json()) as {
      action?: "clear" | "set_leave" | "start_lunch";
      endsAt?: string;
      reason?: string;
    };
    const snapshot = await getWallboardSnapshot();
    const technician = technicianForEmail(snapshot, auth.email);
    if (!technician) {
      return mobileError(
        404,
        "NOT_FOUND",
        "Technician presence profile was not found.",
      );
    }
    const repository = getConfiguredPresenceOverrideRepository();
    if (!repository) {
      return mobileError(
        400,
        "BAD_REQUEST",
        "Presence persistence is not configured.",
      );
    }
    const technicianEmail =
      technician.zohoEmail ?? technician.outlookEmail;

    if (body.action === "start_lunch") {
      return mobileOk({
        override: await repository.startLunch({
          createdByEmail: auth.email,
          source: "technician_app",
          technicianEmail,
        }),
      });
    }

    if (body.action === "set_leave") {
      if (!body.endsAt) {
        return mobileError(
          400,
          "BAD_REQUEST",
          "Leave end date and time is required.",
        );
      }
      return mobileOk({
        override: await repository.setLeave({
          createdByEmail: auth.email,
          endsAt: body.endsAt,
          reason: body.reason,
          source: "technician_app",
          technicianEmail,
        }),
      });
    }

    if (body.action === "clear") {
      await repository.clear({ technicianEmail });
      return mobileOk({ cleared: true });
    }

    return mobileError(400, "BAD_REQUEST", "Unknown presence action.");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Presence request failed.";
    const unauthorized = /bearer token/i.test(message);
    return mobileError(
      unauthorized ? 401 : 400,
      unauthorized ? "UNAUTHORIZED" : "BAD_REQUEST",
      message,
    );
  }
}

function technicianForEmail(
  snapshot: Awaited<ReturnType<typeof getWallboardSnapshot>>,
  email: string,
) {
  const normalized = email.trim().toLowerCase();
  return snapshot.dashboard.technicians.find(
    (technician) =>
      technician.active &&
      [technician.zohoEmail, technician.outlookEmail]
        .filter(Boolean)
        .some((candidate) => candidate?.trim().toLowerCase() === normalized),
  );
}

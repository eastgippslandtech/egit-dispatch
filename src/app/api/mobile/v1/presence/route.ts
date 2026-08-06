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
    const repository = getConfiguredPresenceOverrideRepository();
    if (!repository) {
      return mobileError(
        400,
        "BAD_REQUEST",
        "Presence persistence is not configured.",
      );
    }
    const technicianEmail = auth.email;

    if (body.action === "start_lunch") {
      return mobileOk({
        override: await withPresenceWriteRetry(() =>
          repository.startLunch({
            createdByEmail: auth.email,
            source: "technician_app",
            technicianEmail,
          }),
        ),
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
        override: await withPresenceWriteRetry(() =>
          repository.setLeave({
            createdByEmail: auth.email,
            endsAt: body.endsAt!,
            reason: body.reason,
            source: "technician_app",
            technicianEmail,
          }),
        ),
      });
    }

    if (body.action === "clear") {
      await withPresenceWriteRetry(() => repository.clear({ technicianEmail }));
      return mobileOk({ cleared: true });
    }

    return mobileError(400, "BAD_REQUEST", "Unknown presence action.");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Presence request failed.";
    const unauthorized = /bearer token/i.test(message);
    const temporarilyUnavailable = isTransientPresenceError(error);
    return mobileError(
      unauthorized ? 401 : temporarilyUnavailable ? 503 : 400,
      unauthorized
        ? "UNAUTHORIZED"
        : temporarilyUnavailable
          ? "TEMPORARILY_UNAVAILABLE"
          : "BAD_REQUEST",
      message,
    );
  }
}

async function withPresenceWriteRetry<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientPresenceError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 150));
    return operation();
  }
}

function isTransientPresenceError(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    ["CONNECT_TIMEOUT", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(
      code.toUpperCase(),
    ) || /connect[_ ]timeout|connection terminated|socket|network/i.test(message)
  );
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

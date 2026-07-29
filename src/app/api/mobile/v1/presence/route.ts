import { requireMobileAuth } from "@/server/mobile-api/auth";
import { mobileError, mobileOk } from "@/server/mobile-api/responses";
import { getConfiguredPresenceOverrideRepository } from "@/server/presence/repository";
import { findStaffForZohoLogin } from "@/server/staff/profiles";

export async function POST(request: Request) {
  try {
    const auth = requireMobileAuth(request);
    const body = (await request.json()) as {
      action?: "start_lunch";
    };
    const staff = findStaffForZohoLogin(auth.email);

    if (!staff?.active || !staff.dispatchEnabled) {
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

    if (body.action !== "start_lunch") {
      return mobileError(400, "BAD_REQUEST", "Unknown presence action.");
    }

    return mobileOk({
      override: await repository.startLunch({
        createdByEmail: auth.email,
        source: "technician_app",
        technicianEmail: staff.zohoEmail,
      }),
    });
  } catch (error) {
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 400;
    return mobileError(
      status,
      status === 401 ? "UNAUTHORIZED" : "BAD_REQUEST",
      error instanceof Error ? error.message : "Presence request failed.",
    );
  }
}

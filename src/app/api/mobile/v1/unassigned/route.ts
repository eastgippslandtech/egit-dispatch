import { requireMobileAuth } from "@/server/mobile-api/auth";
import { mobileError, mobileOk } from "@/server/mobile-api/responses";
import { listMobileUnassignedJobs } from "@/server/mobile-api/service";

export async function GET(request: Request) {
  try {
    return mobileOk(
      await listMobileUnassignedJobs({ auth: requireMobileAuth(request) }),
    );
  } catch (error) {
    return mobileError(
      statusFrom(error),
      codeFrom(error),
      error instanceof Error ? error.message : "Unassigned jobs could not be loaded.",
    );
  }
}

function statusFrom(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
    ? error.status
    : 500;
}

function codeFrom(error: unknown): "BAD_REQUEST" | "INTERNAL_ERROR" | "UNAUTHORIZED" {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "UNAUTHORIZED") return "UNAUTHORIZED";
    if (error.code === "BAD_REQUEST") return "BAD_REQUEST";
  }
  return "INTERNAL_ERROR";
}

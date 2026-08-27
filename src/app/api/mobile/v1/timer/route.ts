import { requireMobileAuth } from "@/server/mobile-api/auth";
import { mobileError, mobileOk } from "@/server/mobile-api/responses";
import { getMobileActiveTimer } from "@/server/mobile-api/service";

export async function GET(request: Request) {
  try {
    return mobileOk(
      await getMobileActiveTimer({ auth: requireMobileAuth(request) }),
    );
  } catch (error) {
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 500;
    return mobileError(
      status,
      status === 401 ? "UNAUTHORIZED" : "INTERNAL_ERROR",
      error instanceof Error ? error.message : "Mobile timer could not load.",
    );
  }
}

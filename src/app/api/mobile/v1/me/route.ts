import { requireMobileAuth } from "@/server/mobile-api/auth";
import { mobileError, mobileOk } from "@/server/mobile-api/responses";
import { getMobileMe } from "@/server/mobile-api/service";

export async function GET(request: Request) {
  try {
    return mobileOk(await getMobileMe({ auth: requireMobileAuth(request) }));
  } catch (error) {
    return mobileError(
      401,
      "UNAUTHORIZED",
      error instanceof Error ? error.message : "Mobile bearer token is invalid.",
    );
  }
}

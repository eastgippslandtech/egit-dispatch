import { refreshMobileSession } from "@/server/mobile-api/auth";
import { mobileError, mobileOk } from "@/server/mobile-api/responses";

export async function POST(request: Request) {
  const { refreshToken } = (await request.json()) as { refreshToken?: string };
  if (!refreshToken) {
    return mobileError(400, "BAD_REQUEST", "Refresh token is required.");
  }

  const result = await refreshMobileSession(refreshToken);
  if (result.status === "invalid") {
    return mobileError(401, "UNAUTHORIZED", "Refresh token is invalid.");
  }

  return mobileOk(result);
}

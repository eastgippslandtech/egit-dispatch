import { requireMobileAuth } from "@/server/mobile-api/auth";
import { mobileError, mobileOk } from "@/server/mobile-api/responses";
import { registerMobilePushToken } from "@/server/mobile-api/service";

export async function PUT(request: Request) {
  try {
    const auth = requireMobileAuth(request);
    const body = await request.json();
    return mobileOk(
      await registerMobilePushToken({
        appVersion: body.appVersion,
        installationId: body.installationId,
        platform: body.platform,
        pushToken: body.pushToken,
      }),
      auth.staffId,
    );
  } catch (error) {
    return mobileError(
      401,
      "UNAUTHORIZED",
      error instanceof Error ? error.message : "Mobile bearer token is invalid.",
    );
  }
}

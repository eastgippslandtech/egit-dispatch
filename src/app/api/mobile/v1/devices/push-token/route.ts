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
        auth,
        installationId: body.installationId,
        platform: body.platform,
        pushToken: body.pushToken,
      }),
      auth.staffId,
    );
  } catch (error) {
    const status =
      error instanceof SyntaxError
        ? 400
        : typeof error === "object" &&
            error !== null &&
            "status" in error &&
            typeof error.status === "number"
          ? error.status
          : 500;
    const code =
      error instanceof SyntaxError
        ? "BAD_REQUEST"
        : status === 401
          ? "UNAUTHORIZED"
          : "INTERNAL_ERROR";

    return mobileError(
      status,
      code,
      error instanceof Error ? error.message : "Push registration failed.",
    );
  }
}

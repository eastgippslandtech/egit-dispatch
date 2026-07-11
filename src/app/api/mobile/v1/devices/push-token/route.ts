import { registerMobilePushToken, rileyMobileAuth } from "@/server/mobile-api/service";
import { mobileOk } from "@/server/mobile-api/responses";

export async function PUT(request: Request) {
  const body = await request.json();
  return mobileOk(
    await registerMobilePushToken({
      appVersion: body.appVersion,
      installationId: body.installationId,
      platform: body.platform,
      pushToken: body.pushToken,
    }),
    rileyMobileAuth.staffId,
  );
}

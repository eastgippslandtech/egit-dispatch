import { exchangeMobileLogin } from "@/server/mobile-api/auth";
import { mobileError, mobileOk } from "@/server/mobile-api/responses";

export async function POST(request: Request) {
  const result = await exchangeMobileLogin(await request.json());

  if (result.status === "not-approved") {
    return mobileError(
      403,
      "NOT_APPROVED",
      "This Zoho account is not enabled for Command Centre mobile.",
    );
  }

  return mobileOk(result);
}

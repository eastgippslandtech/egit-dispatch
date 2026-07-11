import { revokeMobileSession } from "@/server/mobile-api/auth";
import { mobileOk } from "@/server/mobile-api/responses";

export async function POST(request: Request) {
  const { refreshToken = "" } = (await request.json()) as {
    refreshToken?: string;
  };
  return mobileOk(await revokeMobileSession(refreshToken));
}

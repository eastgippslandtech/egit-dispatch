import { getMobileMe, rileyMobileAuth } from "@/server/mobile-api/service";
import { mobileOk } from "@/server/mobile-api/responses";

export async function GET() {
  return mobileOk(await getMobileMe({ auth: rileyMobileAuth }));
}

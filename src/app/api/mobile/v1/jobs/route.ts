import { listMobileJobs, rileyMobileAuth } from "@/server/mobile-api/service";
import { mobileOk } from "@/server/mobile-api/responses";

export async function GET(request: Request) {
  const url = new URL(request.url);
  return mobileOk(
    await listMobileJobs({
      auth: rileyMobileAuth,
      from: url.searchParams.get("from") ?? "1970-01-01",
      to: url.searchParams.get("to") ?? "9999-12-31",
    }),
  );
}

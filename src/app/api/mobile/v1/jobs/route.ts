import { after } from "next/server";

import { requireMobileAuth } from "@/server/mobile-api/auth";
import { mobileError, mobileOk } from "@/server/mobile-api/responses";
import { listMobileJobs } from "@/server/mobile-api/service";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return mobileOk(
      await listMobileJobs({
        auth: requireMobileAuth(request),
        deferReconciliation: (task) => after(task),
        from: url.searchParams.get("from") ?? "1970-01-01",
        to: url.searchParams.get("to") ?? "9999-12-31",
      }),
    );
  } catch (error) {
    return mobileError(
      401,
      "UNAUTHORIZED",
      error instanceof Error ? error.message : "Mobile bearer token is invalid.",
    );
  }
}

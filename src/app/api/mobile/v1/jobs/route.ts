import { after } from "next/server";

import { requireMobileAuth } from "@/server/mobile-api/auth";
import type { MobileApiFailureCode } from "@/server/mobile-api/contracts";
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
      statusFrom(error),
      codeFrom(error),
      error instanceof Error ? error.message : "Mobile jobs could not be loaded.",
    );
  }
}

function statusFrom(error: unknown) {
  return typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
    ? error.status
    : 500;
}

function codeFrom(error: unknown): MobileApiFailureCode {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    const code = error.code;
    if (
      code === "BAD_REQUEST" ||
      code === "INTERNAL_ERROR" ||
      code === "NOT_APPROVED" ||
      code === "NOT_FOUND" ||
      code === "READ_ONLY_SOURCE" ||
      code === "TEMPORARILY_UNAVAILABLE" ||
      code === "UNAUTHORIZED"
    ) {
      return code;
    }
  }

  return statusFrom(error) === 401 ? "UNAUTHORIZED" : "INTERNAL_ERROR";
}

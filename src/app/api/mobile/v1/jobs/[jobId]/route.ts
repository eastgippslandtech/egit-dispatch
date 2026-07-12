import { requireMobileAuth } from "@/server/mobile-api/auth";
import { getMobileJob } from "@/server/mobile-api/service";
import { mobileError, mobileOk } from "@/server/mobile-api/responses";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    return mobileOk(
      await getMobileJob({
        auth: requireMobileAuth(_request),
        jobId: (await params).jobId,
      }),
    );
  } catch (error) {
    return mobileError(
      statusFrom(error),
      codeFrom(error),
      error instanceof Error ? error.message : "Mobile job was not found.",
    );
  }
}

function statusFrom(error: unknown): number {
  return typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
    ? error.status
    : 500;
}

function codeFrom(error: unknown): "NOT_FOUND" | "UNAUTHORIZED" {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "UNAUTHORIZED"
    ? "UNAUTHORIZED"
    : "NOT_FOUND";
}

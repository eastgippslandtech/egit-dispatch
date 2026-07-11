import { saveMobileWorklog, rileyMobileAuth } from "@/server/mobile-api/service";
import { mobileError, mobileOk } from "@/server/mobile-api/responses";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    return mobileOk(
      await saveMobileWorklog({
        auth: rileyMobileAuth,
        command: await request.json(),
        jobId: (await params).jobId,
      }),
    );
  } catch (error) {
    return mobileError(
      statusFrom(error),
      codeFrom(error),
      error instanceof Error ? error.message : "Mobile worklog failed.",
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

function codeFrom(error: unknown): "BAD_REQUEST" | "READ_ONLY_SOURCE" {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "READ_ONLY_SOURCE"
    ? "READ_ONLY_SOURCE"
    : "BAD_REQUEST";
}

import { requireMobileAuth } from "@/server/mobile-api/auth";
import { mobileError, mobileOk } from "@/server/mobile-api/responses";
import { stopMobileTimer } from "@/server/mobile-api/service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    return mobileOk(
      await stopMobileTimer({
        auth: requireMobileAuth(request),
        command: await request.json(),
        jobId: (await params).jobId,
      }),
    );
  } catch (error) {
    return mobileError(
      statusFrom(error),
      codeFrom(error),
      error instanceof Error ? error.message : "Mobile timer stop failed.",
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

function codeFrom(
  error: unknown,
): "BAD_REQUEST" | "NOT_FOUND" | "READ_ONLY_SOURCE" | "UNAUTHORIZED" {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "BAD_REQUEST";
  }
  if (error.code === "NOT_FOUND") return "NOT_FOUND";
  if (error.code === "READ_ONLY_SOURCE") return "READ_ONLY_SOURCE";
  if (error.code === "UNAUTHORIZED") return "UNAUTHORIZED";
  return "BAD_REQUEST";
}

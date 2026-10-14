import { after } from "next/server";

import { requireMobileAuth } from "@/server/mobile-api/auth";
import type { BookingType } from "@/server/dispatch/types";
import { requireIdempotencyKey } from "@/server/integrations/http";
import { wakeIntegrationProcessor } from "@/server/integrations/wake";
import { mobileError, mobileOk } from "@/server/mobile-api/responses";
import { scheduleMobileUnassignedJob } from "@/server/mobile-api/service";

type SchedulePayload = {
  bookingType?: BookingType;
  clientMutationId?: string;
  date?: string;
  end?: string;
  start?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const auth = requireMobileAuth(request);
    const jobId = (await params).jobId;
    const payload = (await request.json()) as SchedulePayload;
    let clientMutationId: string;
    try {
      clientMutationId = requireIdempotencyKey(request, payload.clientMutationId);
    } catch (error) {
      throw Object.assign(
        error instanceof Error ? error : new Error("A valid idempotency key is required."),
        { code: "BAD_REQUEST", status: 400 },
      );
    }
    const result = await scheduleMobileUnassignedJob({
      auth,
      bookingType: payload.bookingType as BookingType,
      clientMutationId,
      date: payload.date ?? "",
      end: payload.end ?? "",
      jobId,
      start: payload.start ?? "",
    });
    after(() => wakeIntegrationProcessor(result.operationId).catch(() => undefined));
    return mobileOk(result, result.operationId);
  } catch (error) {
    return mobileError(
      statusFrom(error),
      codeFrom(error),
      error instanceof Error ? error.message : "The request could not be scheduled.",
    );
  }
}

function statusFrom(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
    ? error.status
    : 500;
}

function codeFrom(error: unknown): "BAD_REQUEST" | "INTERNAL_ERROR" | "UNAUTHORIZED" {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "UNAUTHORIZED") return "UNAUTHORIZED";
    if (error.code === "BAD_REQUEST") return "BAD_REQUEST";
  }
  return "INTERNAL_ERROR";
}

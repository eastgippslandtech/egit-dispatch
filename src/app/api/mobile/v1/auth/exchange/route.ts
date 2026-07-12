import { exchangeMobileLogin } from "@/server/mobile-api/auth";
import type { MobileApiFailureCode } from "@/server/mobile-api/contracts";
import { mobileError, mobileOk } from "@/server/mobile-api/responses";

export async function POST(request: Request) {
  try {
    const result = await exchangeMobileLogin(await request.json());

    if (result.status === "not-approved") {
      return mobileError(
        403,
        "NOT_APPROVED",
        "This Zoho account is not enabled for Command Centre mobile.",
      );
    }

    return mobileOk(result);
  } catch (error) {
    return mobileError(
      statusFrom(error),
      codeFrom(error),
      messageFrom(error),
    );
  }
}

const mobileFailureCodes = new Set<MobileApiFailureCode>([
  "BAD_REQUEST",
  "NOT_APPROVED",
  "NOT_FOUND",
  "READ_ONLY_SOURCE",
  "UNAUTHORIZED",
]);

function statusFrom(error: unknown) {
  if (error instanceof SyntaxError) {
    return 400;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status < 600
  ) {
    return error.status;
  }
  return 500;
}

function codeFrom(error: unknown): MobileApiFailureCode {
  if (error instanceof SyntaxError) {
    return "BAD_REQUEST";
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    mobileFailureCodes.has(error.code as MobileApiFailureCode)
  ) {
    return error.code as MobileApiFailureCode;
  }
  return "BAD_REQUEST";
}

function messageFrom(error: unknown) {
  if (error instanceof SyntaxError) {
    return "Invalid mobile auth exchange request.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Zoho sign-in failed. Please try again.";
}

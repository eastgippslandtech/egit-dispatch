import { NextResponse } from "next/server";

import type {
  MobileApiFailure,
  MobileApiFailureCode,
  MobileApiMeta,
  MobileApiSuccess,
} from "./contracts";

export function mobileOk<TData>(
  data: TData,
  requestId = "mobile-local-request",
): NextResponse<MobileApiSuccess<TData>> {
  return NextResponse.json({
    data,
    meta: createMeta(requestId),
  });
}

export function mobileError(
  status: number,
  code: MobileApiFailureCode,
  message: string,
  requestId = "mobile-local-request",
): NextResponse<MobileApiFailure> {
  return NextResponse.json(
    {
      error: { code, message },
      meta: createMeta(requestId),
    },
    { status },
  );
}

export function createMeta(requestId: string): MobileApiMeta {
  return {
    requestId,
    serverTime: new Date().toISOString(),
  };
}

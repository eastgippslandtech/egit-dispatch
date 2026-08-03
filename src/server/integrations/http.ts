import { NextResponse } from "next/server";

const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

export function integrationJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...NO_STORE_HEADERS, ...init?.headers },
  });
}

export function safeIntegrationSummary(value?: string) {
  if (!value) return undefined;
  return value
    .replace(
      /authorization\s*:\s*(?:bearer\s+)?[^\s,;]+/gi,
      "Authorization: [REDACTED]",
    )
    .replace(
      /\b(access_token|refresh_token|client_secret)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function requireIdempotencyKey(
  request: Request,
  bodyValue?: string,
) {
  const value =
    bodyValue?.trim() || request.headers.get("Idempotency-Key")?.trim() || "";
  if (!idempotencyKeyPattern.test(value)) {
    throw new Error("A valid idempotency key is required for this command.");
  }
  return value;
}

export function integrationRouteErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /idempotency key.*different|already used for different/i.test(message)
    ? 409
    : 400;
}

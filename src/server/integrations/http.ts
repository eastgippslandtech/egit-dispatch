const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;

export function requireIdempotencyKey(
  request: Request,
  bodyValue?: string,
) {
  const value =
    bodyValue?.trim() || request.headers.get("Idempotency-Key")?.trim() || "";
  if (!idempotencyKeyPattern.test(value)) {
    throw new Error(
      "A valid idempotency key is required for this command.",
    );
  }
  return value;
}

export function integrationRouteErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /idempotency key.*different|already used for different/i.test(message)
    ? 409
    : 400;
}

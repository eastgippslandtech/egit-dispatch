import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyYeastarWebhookSignature({
  body,
  secret,
  signature,
}: {
  body: string;
  secret: string;
  signature?: string | null;
}) {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature.trim(), "base64");
  } catch {
    return false;
  }
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

export function sanitizeYeastarPayload(
  value: unknown,
): Record<string, unknown> {
  return sanitizeValue(value) as Record<string, unknown>;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) =>
        ![
          "access_token",
          "refresh_token",
          "client_secret",
          "password",
          "recording_url",
          "download_url",
        ].includes(key.toLowerCase()),
      )
      .map(([key, child]) => [key, sanitizeValue(child)]),
  );
}

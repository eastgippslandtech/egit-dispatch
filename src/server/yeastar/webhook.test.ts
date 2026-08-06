import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyYeastarWebhookSignature } from "./webhook";

describe("verifyYeastarWebhookSignature", () => {
  it("accepts the base64 HMAC-SHA256 signature of the raw body", () => {
    const body = '{"event":"30012","call_id":"call-1"}';
    const signature = createHmac("sha256", "secret")
      .update(body)
      .digest("base64");

    expect(
      verifyYeastarWebhookSignature({ body, secret: "secret", signature }),
    ).toBe(true);
  });

  it("rejects missing or altered signatures", () => {
    expect(
      verifyYeastarWebhookSignature({
        body: '{"event":"30012"}',
        secret: "secret",
        signature: "not-valid",
      }),
    ).toBe(false);
  });
});

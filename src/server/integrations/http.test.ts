import { describe, expect, it } from "vitest";

import {
  integrationRouteErrorStatus,
  requireIdempotencyKey,
} from "./http";

describe("integration route command identity", () => {
  it("accepts the body key and supports the standard header", () => {
    const request = new Request("https://command.egit.com.au", {
      headers: { "Idempotency-Key": "header-command-1" },
    });

    expect(requireIdempotencyKey(request, "body-command-1")).toBe(
      "body-command-1",
    );
    expect(requireIdempotencyKey(request)).toBe("header-command-1");
  });

  it("rejects missing, short, or unsafe command keys", () => {
    const request = new Request("https://command.egit.com.au");

    expect(() => requireIdempotencyKey(request)).toThrow(/idempotency key/i);
    expect(() => requireIdempotencyKey(request, "short")).toThrow();
    expect(() => requireIdempotencyKey(request, "unsafe key value")).toThrow();
  });

  it("maps conflicting key reuse to HTTP 409", () => {
    expect(
      integrationRouteErrorStatus(
        new Error("This idempotency key was already used for different work."),
      ),
    ).toBe(409);
    expect(integrationRouteErrorStatus(new Error("Validation failed."))).toBe(400);
  });
});

import { describe, expect, it } from "vitest";

import { createSignOffCommand } from "./sign-off-service";
import { signatureFileName } from "./signature-file";

describe("sign-off service", () => {
  it("requires customer acceptance and a signature", () => {
    expect(() =>
      createSignOffCommand({
        accepted: false,
        baseVersion: "v1",
        customerName: "Alex Morgan",
        installationId: "inst-1",
        jobId: "firewall-riley",
        occurredAt: "2026-07-09T00:00:00.000Z",
        signatureLocalUri: null,
      }),
    ).toThrow("Customer acceptance and signature are required.");
  });

  it("creates a safe signature file name", () => {
    expect(signatureFileName("firewall-riley", "2026-07-09T00:00:00.000Z")).toBe(
      "signature-firewall-riley-2026-07-09T00-00-00-000Z.png",
    );
  });
});

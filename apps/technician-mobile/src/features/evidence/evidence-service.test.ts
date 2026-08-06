import { describe, expect, it } from "vitest";

import { createEvidenceService } from "./evidence-service";

describe("evidence service", () => {
  it("retains a local file URI when upload fails", async () => {
    const evidence = createEvidenceService();
    const item = await evidence.stage({
      byteLength: 1234,
      fileName: "photo.jpg",
      jobId: "job-1",
      kind: "photo",
      localUri: "file:///photo.jpg",
      mimeType: "image/jpeg",
      sha256: "sha256-demo",
    });

    await evidence.markFailed(item.id, "network");

    expect(await evidence.get(item.id)).toMatchObject({
      lastError: "network",
      localUri: "file:///photo.jpg",
      state: "failed",
    });
  });
});

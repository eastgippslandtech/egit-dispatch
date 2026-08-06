import { beforeEach, describe, expect, it, vi } from "vitest";

import { integrationCronAuthorized } from "@/server/yeastar/route-auth";
import { createConfiguredIntegrationWorker } from "@/server/integrations/runtime";

import { POST } from "./route";

vi.mock("@/server/yeastar/route-auth", () => ({ integrationCronAuthorized: vi.fn() }));
vi.mock("@/server/integrations/runtime", () => ({
  createConfiguredIntegrationWorker: vi.fn(),
}));

const authorized = vi.mocked(integrationCronAuthorized);
const createWorker = vi.mocked(createConfiguredIntegrationWorker);
const processDue = vi.fn();
const countDueSteps = vi.fn();

describe("integration process route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorized.mockReturnValue(true);
    processDue.mockResolvedValue({
      claimed: 4,
      processingErrors: 0,
      retrying: 1,
      reviewRequired: 1,
      succeeded: 2,
    });
    countDueSteps.mockResolvedValue(3);
    createWorker.mockReturnValue({
      processor: { processDue },
      repository: { countDueSteps },
    } as never);
  });

  it("rejects requests without the cron secret", async () => {
    authorized.mockReturnValue(false);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("processes a bounded batch and reports remaining due work", async () => {
    const response = await POST(request({ limit: 999 }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(processDue).toHaveBeenCalledWith({ limit: 3 });
    await expect(response.json()).resolves.toEqual({
      claimed: 4,
      processingErrors: 0,
      remainingDue: 3,
      retrying: 1,
      reviewRequired: 1,
      succeeded: 2,
    });
  });

  it("uses the safe batch size when the scheduler does not provide a limit", async () => {
    await POST(request());

    expect(processDue).toHaveBeenCalledWith({ limit: 3 });
  });

  it("returns a safe unavailable response when the batch cannot start", async () => {
    createWorker.mockImplementation(() => {
      throw new Error("refresh_token=secret-value database host failed");
    });

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(payload).toEqual({ error: "Integration processing is temporarily unavailable." });
    expect(JSON.stringify(payload)).not.toContain("secret-value");
  });
});

function request(body: unknown = {}) {
  return new Request("https://command.egit.com.au/api/internal/integrations/process", {
    body: JSON.stringify(body),
    headers: { Authorization: "Bearer cron-secret", "Content-Type": "application/json" },
    method: "POST",
  });
}

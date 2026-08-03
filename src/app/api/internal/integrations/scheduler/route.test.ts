import { beforeEach, describe, expect, it, vi } from "vitest";

import { configureIntegrationScheduler } from "@/server/integrations/scheduler";
import { integrationCronAuthorized } from "@/server/yeastar/route-auth";

import { POST } from "./route";

vi.mock("@/server/integrations/scheduler", () => ({
  configureIntegrationScheduler: vi.fn(),
}));
vi.mock("@/server/yeastar/route-auth", () => ({ integrationCronAuthorized: vi.fn() }));

const authorized = vi.mocked(integrationCronAuthorized);
const configure = vi.mocked(configureIntegrationScheduler);

describe("integration scheduler route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorized.mockReturnValue(true);
    configure.mockResolvedValue({
      jobId: 7,
      jobName: "command-centre-integration-recovery",
      schedule: "* * * * *",
    });
    vi.stubEnv("DATABASE_URL", "postgres://example");
    vi.stubEnv("INTEGRATION_CRON_SECRET", "scheduler-secret");
    vi.stubEnv("APP_BASE_URL", "https://command.egit.com.au");
  });

  it("requires cron authorization", async () => {
    authorized.mockReturnValue(false);
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(configure).not.toHaveBeenCalled();
  });

  it("configures the fixed process endpoint without exposing the secret", async () => {
    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(configure).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointUrl: "https://command.egit.com.au/api/internal/integrations/process",
        secret: "scheduler-secret",
      }),
    );
    expect(payload).toEqual({
      jobId: 7,
      jobName: "command-centre-integration-recovery",
      schedule: "* * * * *",
    });
    expect(JSON.stringify(payload)).not.toContain("scheduler-secret");
  });
});

function request() {
  return new Request("https://command.egit.com.au/api/internal/integrations/scheduler", {
    headers: { Authorization: "Bearer scheduler-secret" },
    method: "POST",
  });
}

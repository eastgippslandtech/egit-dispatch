import { afterEach, describe, expect, it, vi } from "vitest";

import { wakeIntegrationProcessor } from "./wake";

describe("integration processor wake-up", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does nothing when the worker is not configured yet", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("APP_BASE_URL", "");
    vi.stubEnv("AUTH_URL", "");
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("INTEGRATION_CRON_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");

    await wakeIntegrationProcessor("operation-1");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the protected worker without exposing the secret in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("APP_BASE_URL", "https://command.egit.com.au");
    vi.stubEnv("INTEGRATION_CRON_SECRET", "test-secret");

    await wakeIntegrationProcessor("operation-1");

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://command.egit.com.au/api/internal/integrations/process"),
      expect.objectContaining({
        body: JSON.stringify({ operationId: "operation-1" }),
        headers: {
          Authorization: "Bearer test-secret",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );
  });

  it("does not fall back to the legacy cron secret", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("APP_BASE_URL", "https://command.egit.com.au");
    vi.stubEnv("INTEGRATION_CRON_SECRET", "");
    vi.stubEnv("CRON_SECRET", "legacy-secret");

    await wakeIntegrationProcessor("operation-1");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

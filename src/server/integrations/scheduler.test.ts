import { describe, expect, it, vi } from "vitest";

import {
  buildIntegrationCronCommand,
  configureIntegrationScheduler,
} from "./scheduler";

describe("integration recovery scheduler", () => {
  it("builds a minute worker command that reads authorization from Vault", () => {
    const command = buildIntegrationCronCommand(
      "https://command.egit.com.au/api/internal/integrations/process",
    );

    expect(command).toContain("net.http_post");
    expect(command).toContain("vault.decrypted_secrets");
    expect(command).toContain("command_centre_integration_cron_secret");
    expect(command).toContain("Authorization");
    expect(command).not.toContain("test-secret-value");
  });

  it("rejects a non-HTTPS endpoint before opening a database connection", async () => {
    const connect = vi.fn();

    await expect(
      configureIntegrationScheduler({
        connect,
        databaseUrl: "postgres://example",
        endpointUrl: "http://command.egit.com.au/api/internal/integrations/process",
        secret: "test-secret-value",
      }),
    ).rejects.toThrow("HTTPS");
    expect(connect).not.toHaveBeenCalled();
  });

  it("stores the secret in Vault and returns only non-sensitive job metadata", async () => {
    const unsafe = vi.fn().mockResolvedValue([]);
    const sql = Object.assign(
      vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ jobId: 42 }]),
      { end: vi.fn().mockResolvedValue(undefined), unsafe },
    );

    const result = await configureIntegrationScheduler({
      connect: vi.fn(() => sql as never),
      databaseUrl: "postgres://example",
      endpointUrl: "https://command.egit.com.au/api/internal/integrations/process",
      secret: "test-secret-value",
    });

    expect(result).toEqual({
      jobId: 42,
      jobName: "command-centre-integration-recovery",
      schedule: "* * * * *",
    });
    expect(JSON.stringify(result)).not.toContain("test-secret-value");
    expect(unsafe).toHaveBeenCalledTimes(2);
    expect(sql.end).toHaveBeenCalled();
  });
});

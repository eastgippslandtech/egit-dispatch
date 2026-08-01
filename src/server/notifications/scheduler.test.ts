import { describe, expect, it } from "vitest";

import { buildNotificationCronCommand } from "./scheduler";

describe("notification scheduler", () => {
  it("builds a protected HTTPS poll without embedding the secret", () => {
    const command = buildNotificationCronCommand(
      "https://command.egit.com.au/api/internal/notifications/poll",
    );

    expect(command).toContain(
      "https://command.egit.com.au/api/internal/notifications/poll",
    );
    expect(command).toContain("command_centre_cron_secret");
    expect(command).toContain("vault.decrypted_secrets");
    expect(command).not.toContain("actual-secret");
  });
});

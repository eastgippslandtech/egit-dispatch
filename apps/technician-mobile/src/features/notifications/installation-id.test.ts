import { describe, expect, it, vi } from "vitest";

import { getOrCreateNotificationInstallationId } from "./installation-id";

describe("notification installation ID", () => {
  it("reuses the app installation ID already stored on the phone", async () => {
    const store = {
      getItemAsync: vi.fn(async () => "install-existing"),
      setItemAsync: vi.fn(async () => undefined),
    };

    const installationId = await getOrCreateNotificationInstallationId({
      createId: () => "install-new",
      store,
    });

    expect(installationId).toBe("install-existing");
    expect(store.setItemAsync).not.toHaveBeenCalled();
  });

  it("creates and persists a unique ID for a new app installation", async () => {
    const store = {
      getItemAsync: vi.fn(async () => null),
      setItemAsync: vi.fn(async () => undefined),
    };

    const installationId = await getOrCreateNotificationInstallationId({
      createId: () => "install-new",
      store,
    });

    expect(installationId).toBe("install-new");
    expect(store.setItemAsync).toHaveBeenCalledWith(
      "command-centre.notification-installation.v1",
      "install-new",
    );
  });
});

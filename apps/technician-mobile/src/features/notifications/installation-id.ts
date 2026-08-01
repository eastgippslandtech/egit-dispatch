const NOTIFICATION_INSTALLATION_KEY =
  "command-centre.notification-installation.v1";

interface InstallationIdStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}

export async function getOrCreateNotificationInstallationId({
  createId = createNotificationInstallationId,
  store,
}: {
  createId?: () => string;
  store: InstallationIdStore;
}): Promise<string> {
  const existing = await store.getItemAsync(NOTIFICATION_INSTALLATION_KEY);
  if (existing) {
    return existing;
  }

  const installationId = createId();
  await store.setItemAsync(NOTIFICATION_INSTALLATION_KEY, installationId);
  return installationId;
}

function createNotificationInstallationId(): string {
  return `cc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

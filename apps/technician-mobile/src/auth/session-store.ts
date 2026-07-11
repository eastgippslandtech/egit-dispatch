export interface MobileSession {
  accessToken: string;
  expiresAt: string;
  refreshToken: string;
  staffEmail: string;
}

const SESSION_KEY = "command-centre.mobile-session.v1";

export async function restoreMobileSession(): Promise<MobileSession | null> {
  const secureStore = await import("expo-secure-store");
  const raw = await secureStore.getItemAsync(SESSION_KEY);
  return raw ? (JSON.parse(raw) as MobileSession) : null;
}

export async function saveMobileSession(session: MobileSession): Promise<void> {
  const secureStore = await import("expo-secure-store");
  await secureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
    keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearMobileSession(): Promise<void> {
  const secureStore = await import("expo-secure-store");
  await secureStore.deleteItemAsync(SESSION_KEY);
}

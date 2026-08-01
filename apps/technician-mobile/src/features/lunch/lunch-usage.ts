import { todayDateKey } from "../schedule/date-keys";

const LUNCH_USAGE_KEY_PREFIX = "command-centre.lunch-used-date.v1";

export async function hasUsedLunchToday(
  staffEmail: string,
  now = new Date(),
): Promise<boolean> {
  const secureStore = await loadSecureStore();
  if (!secureStore) return false;

  return (
    (await secureStore.getItemAsync(lunchUsageKey(staffEmail))) ===
    todayDateKey(now)
  );
}

export async function markLunchUsedToday(
  staffEmail: string,
  now = new Date(),
): Promise<void> {
  const secureStore = await loadSecureStore();
  await secureStore?.setItemAsync(lunchUsageKey(staffEmail), todayDateKey(now));
}

function lunchUsageKey(staffEmail: string) {
  return `${LUNCH_USAGE_KEY_PREFIX}.${staffEmail.toLowerCase()}`;
}

async function loadSecureStore(): Promise<
  | {
      getItemAsync(key: string): Promise<string | null>;
      setItemAsync(key: string, value: string): Promise<void>;
    }
  | null
> {
  try {
    return await import("expo-secure-store");
  } catch {
    return null;
  }
}

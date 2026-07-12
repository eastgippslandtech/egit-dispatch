const DEFAULT_API_BASE_URL = "https://command.egit.com.au";
const DEFAULT_AUTH_MODE = "zoho";

export interface MobileRuntimeConfig {
  apiBaseUrl: string;
  authMode: "mock" | "zoho";
  mobileApiBaseUrl: string;
  zohoClientId: string;
}

export function getMobileRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
  { isDevelopment = isNativeDevelopment() }: { isDevelopment?: boolean } = {},
): MobileRuntimeConfig {
  const apiBaseUrl = stripTrailingSlash(
    env.EXPO_PUBLIC_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL,
  );
  const authMode = env.EXPO_PUBLIC_AUTH_MODE === "mock" && isDevelopment
    ? "mock"
    : DEFAULT_AUTH_MODE;

  return {
    apiBaseUrl,
    authMode,
    mobileApiBaseUrl: apiBaseUrl.endsWith("/api/mobile/v1")
      ? apiBaseUrl
      : `${apiBaseUrl}/api/mobile/v1`,
    zohoClientId: env.EXPO_PUBLIC_ZOHO_CLIENT_ID?.trim() ?? "",
  };
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isNativeDevelopment(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__;
}

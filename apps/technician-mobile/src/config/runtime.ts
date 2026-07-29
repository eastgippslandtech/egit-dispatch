const DEFAULT_API_BASE_URL = "https://command.egit.com.au";
const DEFAULT_AUTH_MODE = "zoho";
const DEFAULT_ZOHO_CLIENT_ID = "1000.JW3AY19TI2SGLRCGOWJ1TSUW6T681P";
const DEFAULT_PAYMENTS_APP_URL = "egitpayments://take-payment";

export interface MobileRuntimeConfig {
  apiBaseUrl: string;
  authMode: "mock" | "zoho";
  mobileApiBaseUrl: string;
  paymentsAppUrl: string;
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
    paymentsAppUrl:
      env.EXPO_PUBLIC_PAYMENTS_APP_URL?.trim() || DEFAULT_PAYMENTS_APP_URL,
    zohoClientId:
      env.EXPO_PUBLIC_ZOHO_CLIENT_ID?.trim() || DEFAULT_ZOHO_CLIENT_ID,
  };
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isNativeDevelopment(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__;
}

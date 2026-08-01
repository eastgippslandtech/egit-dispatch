export type ZohoCrmConfig = {
  accountsUrl: string;
  apiDomain: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

export function readZohoCrmConfig(
  env: Record<string, string | undefined> = process.env,
): ZohoCrmConfig | null {
  const clientId = env.ZOHO_CRM_CLIENT_ID?.trim();
  const clientSecret = env.ZOHO_CRM_CLIENT_SECRET?.trim();
  const refreshToken = env.ZOHO_CRM_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;
  return {
    accountsUrl:
      env.ZOHO_CRM_ACCOUNTS_URL?.trim() || "https://accounts.zoho.com.au",
    apiDomain:
      env.ZOHO_CRM_API_DOMAIN?.trim() || "https://www.zohoapis.com.au",
    clientId,
    clientSecret,
    refreshToken,
  };
}

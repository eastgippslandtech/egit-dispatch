import Zoho from "next-auth/providers/zoho";

const DEFAULT_ZOHO_ACCOUNTS_URL = "https://accounts.zoho.com.au";

type ZohoProviderOptions = {
  accountsUrl?: string;
  clientId?: string;
  clientSecret?: string;
};

export function createZohoProvider({
  accountsUrl = process.env.ZOHO_ACCOUNTS_URL ?? DEFAULT_ZOHO_ACCOUNTS_URL,
  clientId,
  clientSecret,
}: ZohoProviderOptions) {
  const zohoAccountsUrl = accountsUrl.replace(/\/+$/, "");

  return {
    ...Zoho({ clientId, clientSecret }),
    authorization: `${zohoAccountsUrl}/oauth/v2/auth?scope=AaaServer.profile.Read`,
    token: `${zohoAccountsUrl}/oauth/v2/token`,
    userinfo: `${zohoAccountsUrl}/oauth/user/info`,
  };
}

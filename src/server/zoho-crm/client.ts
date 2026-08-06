import type { ZohoCrmConfig } from "./config";
import type { ZohoCrmAccountRecord } from "./address-enrichment";

const CRM_REQUEST_TIMEOUT_MS = 8_000;

export type ZohoCrmRecord = {
  Account_Name?: string | { id?: string; name?: string };
  Full_Name?: string;
  id: string;
};

export class ZohoCrmClient {
  private access?: { expiresAt: number; token: string };

  constructor(
    private readonly config: ZohoCrmConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  searchContactsByPhone(phone: string) {
    return this.search("Contacts", phone);
  }

  searchAccountsByPhone(phone: string) {
    return this.search("Accounts", phone);
  }

  async listAccounts(): Promise<ZohoCrmAccountRecord[]> {
    const token = await this.getToken();
    const accounts: ZohoCrmAccountRecord[] = [];
    const fields = [
      "Account_Name",
      "Shipping_Street",
      "Shipping_City",
      "Shipping_State",
      "Shipping_Code",
      "Shipping_Country",
      "Billing_Street",
      "Billing_City",
      "Billing_State",
      "Billing_Code",
      "Billing_Country",
    ].join(",");

    for (let page = 1; page <= 10; page += 1) {
      const url = new URL("/crm/v8/Accounts", this.config.apiDomain);
      url.searchParams.set("fields", fields);
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", "200");
      const response = await this.fetchImpl(url, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        signal: requestSignal(),
      });
      const payload = (await response.json()) as {
        data?: ZohoCrmAccountRecord[];
        info?: { more_records?: boolean };
        message?: string;
      };
      if (!response.ok) {
        throw new Error(
          `Zoho CRM Accounts read failed (${response.status}): ${payload.message ?? "Request failed"}`,
        );
      }
      accounts.push(...(payload.data ?? []));
      if (!payload.info?.more_records) break;
    }

    return accounts;
  }

  private async search(module: "Contacts" | "Accounts", phone: string) {
    const token = await this.getToken();
    const url = new URL(`/crm/v8/${module}/search`, this.config.apiDomain);
    url.searchParams.set("phone", phone);
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      signal: requestSignal(),
    });
    if (response.status === 204) return [];
    const payload = (await response.json()) as {
      data?: ZohoCrmRecord[];
      message?: string;
    };
    if (!response.ok) {
      throw new Error(
        `Zoho CRM search failed (${response.status}): ${payload.message ?? "Request failed"}`,
      );
    }
    return payload.data ?? [];
  }

  private async getToken() {
    if (this.access && this.access.expiresAt > Date.now() + 60_000) {
      return this.access.token;
    }
    const url = new URL("/oauth/v2/token", this.config.accountsUrl);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("client_secret", this.config.clientSecret);
    url.searchParams.set("refresh_token", this.config.refreshToken);
    url.searchParams.set("grant_type", "refresh_token");
    const response = await this.fetchImpl(url, {
      method: "POST",
      signal: requestSignal(),
    });
    const payload = (await response.json()) as {
      access_token?: string;
      api_domain?: string;
      error?: string;
      expires_in?: number;
    };
    if (!response.ok || !payload.access_token) {
      throw new Error(
        `Zoho CRM token refresh failed: ${payload.error ?? response.status}`,
      );
    }
    this.access = {
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
      token: payload.access_token,
    };
    return this.access.token;
  }
}

function requestSignal() {
  return AbortSignal.timeout(CRM_REQUEST_TIMEOUT_MS);
}

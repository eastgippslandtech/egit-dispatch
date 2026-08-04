import { describe, expect, it, vi } from "vitest";

import { ZohoCrmClient } from "./client";

const config = {
  accountsUrl: "https://accounts.zoho.com.au",
  apiDomain: "https://www.zohoapis.com.au",
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
};

describe("ZohoCrmClient Accounts", () => {
  it("loads every Account page with the address fields required by dispatch", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ access_token: "access-token", expires_in: 3600 }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({
          data: [{ Account_Name: "Acme", Shipping_Street: "1 Main Street", id: "1" }],
          info: { more_records: true },
        }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({
          data: [{ Account_Name: "Beta", Billing_Street: "2 Main Street", id: "2" }],
          info: { more_records: false },
        }),
        ok: true,
      });
    const client = new ZohoCrmClient(config, fetchImpl as typeof fetch);

    await expect(client.listAccounts()).resolves.toHaveLength(2);

    const firstAccountsUrl = new URL(String(fetchImpl.mock.calls[1][0]));
    const secondAccountsUrl = new URL(String(fetchImpl.mock.calls[2][0]));
    expect(firstAccountsUrl.pathname).toBe("/crm/v8/Accounts");
    expect(firstAccountsUrl.searchParams.get("fields")).toContain("Shipping_Street");
    expect(firstAccountsUrl.searchParams.get("per_page")).toBe("200");
    expect(firstAccountsUrl.searchParams.get("page")).toBe("1");
    expect(secondAccountsUrl.searchParams.get("page")).toBe("2");
  });
});

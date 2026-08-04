import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";

import { createPostgresMspOAuthCredentialStore } from "./credential-store";

describe("MSP Central OAuth service credential store", () => {
  it("reads a server-only refresh credential without schema DDL", async () => {
    const queries: string[] = [];
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      queries.push(strings.join("?"));
      return [
        {
          apiDomain: "https://servicedeskplus.net.au",
          refreshToken: "stored-refresh-token",
        },
      ];
    });
    const store = createPostgresMspOAuthCredentialStore(
      sql as unknown as postgres.Sql,
    );

    await expect(store.getCredential()).resolves.toEqual({
      apiDomain: "https://servicedeskplus.net.au",
      refreshToken: "stored-refresh-token",
    });
    expect(queries[0]).toContain("from public.msp_oauth_service_credentials");
    expect(queries[0]).not.toMatch(/create table|alter table|revoke all/i);
  });

  it("stores a replacement refresh token without returning it", async () => {
    const queries: string[] = [];
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      queries.push(strings.join("?"));
      return [];
    });
    const store = createPostgresMspOAuthCredentialStore(
      sql as unknown as postgres.Sql,
    );

    await expect(
      store.saveCredential({
        apiDomain: "https://servicedeskplus.net.au",
        refreshToken: "new-refresh-token",
        updatedBy: "simeon@egit.com.au",
      }),
    ).resolves.toBeUndefined();
    expect(queries[0]).toContain("insert into public.msp_oauth_service_credentials");
  });
});

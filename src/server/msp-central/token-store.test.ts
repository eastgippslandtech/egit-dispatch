import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";

import { createPostgresMspOAuthTokenStore } from "./token-store";

describe("MSP Central OAuth token store", () => {
  it("does not run schema DDL during an ordinary token read", async () => {
    const queries: string[] = [];
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      queries.push(strings.join("?"));
      return [];
    });
    const store = createPostgresMspOAuthTokenStore(
      sql as unknown as postgres.Sql,
    );

    await store.getToken("portal-token");

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("from public.msp_oauth_access_tokens");
    expect(queries[0]).not.toMatch(/create table|alter table|revoke all/i);
  });

  it("creates the token cache table when production is missing the migration", async () => {
    const queries: string[] = [];
    let firstRead = true;
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (firstRead && query.includes("from public.msp_oauth_access_tokens")) {
        firstRead = false;
        throw Object.assign(new Error("relation msp_oauth_access_tokens does not exist"), {
          code: "42P01",
        });
      }
      return [];
    });
    const store = createPostgresMspOAuthTokenStore(
      sql as unknown as postgres.Sql,
    );

    await expect(store.getToken("portal-token")).resolves.toBeNull();

    expect(queries.some((query) => /create table if not exists/i.test(query))).toBe(
      true,
    );
    expect(
      queries.filter((query) =>
        query.includes("from public.msp_oauth_access_tokens"),
      ),
    ).toHaveLength(2);
  });
});

import { describe, expect, it } from "vitest";

import {
  getServerlessPostgresOptions,
  normalizeServerlessDatabaseUrl,
} from "./postgres-options";

describe("serverless Postgres connection URL", () => {
  it("bounds ordinary queries and lock waits", () => {
    expect(getServerlessPostgresOptions()).toMatchObject({
      connection: {
        lock_timeout: 2_000,
        statement_timeout: 8_000,
      },
    });
  });

  it("uses the Supabase transaction pooler instead of session mode", () => {
    expect(
      normalizeServerlessDatabaseUrl(
        "postgresql://postgres.project:secret@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres",
      ),
    ).toBe(
      "postgresql://postgres.project:secret@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres",
    );
  });

  it("does not change direct or already pooled database URLs", () => {
    expect(
      normalizeServerlessDatabaseUrl(
        "postgresql://postgres:secret@db.project.supabase.co:5432/postgres",
      ),
    ).toBe(
      "postgresql://postgres:secret@db.project.supabase.co:5432/postgres",
    );
    expect(
      normalizeServerlessDatabaseUrl(
        "postgresql://postgres.project:secret@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres",
      ),
    ).toBe(
      "postgresql://postgres.project:secret@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres",
    );
  });
});

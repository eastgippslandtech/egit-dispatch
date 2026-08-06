import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("integration worker forward migration", () => {
  const migration = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/20260803235500_integration_worker_operations.sql",
    ),
    "utf8",
  );

  it("adds separate connector read/write timestamps additively", () => {
    expect(migration).toContain("add column if not exists last_read_at");
    expect(migration).toContain("add column if not exists last_write_at");
  });

  it("stores only bounded operator audit identity and actions", () => {
    expect(migration).toContain("add column if not exists actor_email varchar(320)");
    expect(migration).toContain("operator_action in ('retry', 'cancel')");
    expect(migration).not.toMatch(/secret|token|authorization/i);
  });
});

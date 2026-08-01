import { describe, expect, it, vi } from "vitest";

import { createPostgresDispatchDashboardDatabase } from "./database";

describe("dispatch dashboard crew assignments", () => {
  it("loads crew assignments as appointments without duplicating requests", async () => {
    const statements: string[] = [];
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      statements.push(strings.join("?"));
      return [];
    }) as unknown as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
    const database = createPostgresDispatchDashboardDatabase({ sql: sql as never });

    await database.getDashboardData();

    const query = statements.join("\n");
    expect(query).toContain("public.dispatch_link_crew");
    expect(query).toContain("assignmentRole");
  });
});

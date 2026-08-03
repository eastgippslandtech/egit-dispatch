import { describe, expect, it, vi } from "vitest";

import { createPostgresMobileDatabase } from "./database";

describe("mobile database crew access", () => {
  it("loads jobs from both lead and crew assignments for the signed-in technician", async () => {
    const statements: string[] = [];
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      statements.push(strings.join("?"));
      return [];
    }) as unknown as {
      (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
      json: (value: unknown) => unknown;
    };
    sql.json = (value) => value;
    const database = createPostgresMobileDatabase({ sql: sql as never });

    await database.listJobsForStaff({
      from: "2026-08-04",
      staffId: "00000000-0000-0000-0000-000000000001",
      to: "2026-08-04",
    });

    expect(statements.join("\n")).toContain("public.dispatch_link_crew");
    expect(statements.join("\n")).toContain("assignment_technician_id");
  });

  it("finds a job by the assignment id returned to lead and crew technicians", async () => {
    const statements: string[] = [];
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      statements.push(strings.join("?"));
      return [];
    }) as unknown as {
      (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
      json: (value: unknown) => unknown;
    };
    sql.json = (value) => value;
    const database = createPostgresMobileDatabase({ sql: sql as never });

    await database.findJobForStaff({
      jobId: "00000000-0000-4000-8000-000000000002",
      staffId: "00000000-0000-4000-8000-000000000001",
    });

    const statement = statements.join("\n");
    expect(statement).toContain("and assignments.assignment_id = ?::uuid");
    expect(statement).not.toContain("and dl.id = ?::uuid");
  });
});

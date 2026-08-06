import { describe, expect, it, vi } from "vitest";

import { createPostgresDispatchLinkStore } from "./link-store";

describe("dispatch link store crew persistence", () => {
  it("stores the lead on the dispatch link and replaces the linked crew roster", async () => {
    const statements: string[] = [];
    let technicianLookup = 0;
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const statement = strings.join("?");
      statements.push(statement);
      if (statement.includes("select t.id::text")) {
        technicianLookup += 1;
        return [{ id: technicianLookup === 1 ? "lead-db-id" : "crew-db-id" }];
      }
      if (statement.includes("returning id::text")) {
        return [{ id: "dispatch-link-id" }];
      }
      return [];
    }) as unknown as {
      (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
      json: (value: unknown) => unknown;
    };
    sql.json = (value) => value;
    const store = createPostgresDispatchLinkStore({ sql: sql as never });

    await store.save({
      action: "live_schedule",
      crew: [
        {
          outlookCalendarEmail: "jervy@egit.com.au",
          outlookEventId: "event-jervy",
          syncStatus: "linked",
          technicianEmail: "jervy@egit.com.au",
          technicianId: "tech-jervy",
        },
      ],
      outlookCalendarEmail: "mattd@egit.com.au",
      outlookEventId: "event-matt",
      requestId: "request-1",
      requestNumber: "REQ-1",
      scheduledEnd: "2026-08-04T11:00:00+10:00",
      scheduledStart: "2026-08-04T10:00:00+10:00",
      subject: "Team booking",
      syncStatus: "linked",
      technicianEmail: "mattd@egit.com.au",
      technicianId: "tech-matt",
    });

    expect(
      statements.some((statement) =>
        statement.includes("insert into public.dispatch_link_crew"),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes("delete from public.dispatch_link_crew"),
      ),
    ).toBe(true);
  });
});

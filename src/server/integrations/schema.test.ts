import fs from "node:fs";
import path from "node:path";

describe("durable integration schema", () => {
  it("defines the integration operation tables and reliability safeguards", () => {
    const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
    const migrationName = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith("_integration_operations.sql"))
      .sort()
      .at(-1);

    expect(migrationName).toBeDefined();

    const sql = fs.readFileSync(path.join(migrationsDir, migrationName!), "utf8");

    expect(sql).toContain("create table public.integration_operations");
    expect(sql).toContain("idempotency_key text not null unique");
    expect(sql).toContain("check (state in ('queued','syncing','retrying','synced','review_required','cancelled'))");
    expect(sql).toContain("create table public.integration_operation_steps");
    expect(sql).toContain("unique (operation_id, step_key)");
    expect(sql).toContain("check (state in ('queued','processing','retrying','succeeded','review_required','cancelled'))");
    expect(sql).toContain("lease_expires_at timestamptz");
    expect(sql).toContain("attempt_count integer not null default 0");
    expect(sql).toContain("next_attempt_at timestamptz");
    expect(sql).toContain("create table public.integration_audit_events");
    expect(sql).toContain("create table public.integration_connector_health");
    expect(sql).toContain("check (connector in ('command_centre','msp_central','outlook','zoho_crm','msp_endpoint','zoho_survey','push','email'))");

    expect(sql).toContain("create index integration_operation_steps_due_idx");
    expect(sql).toContain("where state in ('queued','retrying')");
    expect(sql).toContain("create index integration_audit_events_request_idx");
    expect(sql).toContain("(request_id, created_at desc)");
    expect(sql).toContain("create index integration_operations_failed_idx");
    expect(sql).toContain("create index integration_connector_health_freshness_idx");

    for (const table of [
      "integration_operations",
      "integration_operation_steps",
      "integration_audit_events",
      "integration_connector_health",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`revoke all on public.${table} from anon, authenticated`);
    }
  });
});

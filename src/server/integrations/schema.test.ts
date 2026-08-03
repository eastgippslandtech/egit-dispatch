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

    const auditTable = sql.match(
      /create table public\.integration_audit_events \(([\s\S]*?)\n\);/,
    )?.[1];
    expect(auditTable).toBeDefined();
    expect(auditTable!).not.toMatch(/\b(?:details|payload)\s+jsonb\b/);

    for (const column of [
      "request_id varchar(128) not null",
      "event_type varchar(64) not null",
      "outcome varchar(32)",
      "error_code varchar(64)",
      "attempt_count integer",
      "http_status integer",
      "duration_ms integer",
      "step_key varchar(64)",
      "external_record_id varchar(128)",
      "external_version varchar(64)",
    ]) {
      expect(auditTable).toContain(column);
    }

    for (const constraint of [
      "request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'",
      "event_type ~ '^[a-z][a-z0-9_.-]{0,63}$'",
      "outcome is null or outcome ~ '^[a-z][a-z0-9_.-]{0,31}$'",
      "error_code is null or error_code ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'",
      "attempt_count is null or attempt_count between 0 and 1000",
      "http_status is null or http_status between 100 and 599",
      "duration_ms is null or duration_ms between 0 and 86400000",
      "step_key is null or step_key ~ '^[a-z][a-z0-9_.-]{0,63}$'",
      "external_record_id is null or external_record_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'",
      "external_version is null or external_version ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$'",
    ]) {
      expect(auditTable).toContain(constraint);
    }

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
      expect(sql).toContain(
        `grant select, insert, update, delete\n  on public.${table} to service_role`,
      );
    }
  });
});

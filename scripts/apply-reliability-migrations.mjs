import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const migrations = [
  "20260802120000_worklog_disposition_operation_migration_links.sql",
  "20260803101626_integration_operations.sql",
  "20260803103000_worklog_disposition_operation_migration_fk.sql",
  "20260803235500_integration_worker_operations.sql",
];

if (process.env.VERCEL_ENV !== "production") {
  console.log("Reliability migrations skipped outside production.");
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to apply production reliability migrations.");
}

const sql = postgres(databaseUrl, {
  connect_timeout: 20,
  idle_timeout: 5,
  max: 1,
  prepare: false,
  ssl: "require",
});

try {
  await sql`
    create schema if not exists supabase_migrations
  `;
  await sql`
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    )
  `;

  const historyColumns = await sql`
    select column_name
    from information_schema.columns
    where table_schema = 'supabase_migrations'
      and table_name = 'schema_migrations'
  `;
  const historyColumnNames = new Set(historyColumns.map(({ column_name }) => column_name));

  for (const filename of migrations) {
    const version = filename.slice(0, 14);
    const name = filename.slice(15, -4);
    const [existing] = await sql`
      select version
      from supabase_migrations.schema_migrations
      where version = ${version}
      limit 1
    `;

    if (existing) {
      console.log(`Reliability migration ${version} already applied.`);
      continue;
    }

    const migrationSql = await readFile(
      path.join(process.cwd(), "supabase", "migrations", filename),
      "utf8",
    );

    await sql.begin(async (transaction) => {
      await transaction.unsafe(migrationSql);

      const historyRecord = { version };
      if (historyColumnNames.has("name")) historyRecord.name = name;
      if (historyColumnNames.has("statements")) historyRecord.statements = [migrationSql];

      await transaction`
        insert into supabase_migrations.schema_migrations
        ${transaction(historyRecord)}
      `;
    });

    console.log(`Applied reliability migration ${version}.`);
  }
} finally {
  await sql.end({ timeout: 5 });
}

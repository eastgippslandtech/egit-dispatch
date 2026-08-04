import postgres from "postgres";

import {
  getServerlessPostgresOptions,
  normalizeServerlessDatabaseUrl,
} from "@/server/database/postgres-options";

const SECRET_NAME = "command_centre_integration_cron_secret";

export async function configureYeastarScheduler({
  baseUrl,
  databaseUrl,
  secret,
}: {
  baseUrl: string;
  databaseUrl: string;
  secret: string;
}) {
  const origin = new URL(baseUrl).origin;
  if (!origin.startsWith("https://")) {
    throw new Error("The integration scheduler requires an HTTPS application URL.");
  }
  const sql = postgres(
    normalizeServerlessDatabaseUrl(databaseUrl),
    getServerlessPostgresOptions(),
  );
  try {
    await sql.unsafe("create extension if not exists pg_net with schema extensions");
    await sql.unsafe("create extension if not exists pg_cron with schema pg_catalog");
    const existing = await sql<Array<{ id: string }>>`
      select id::text as id
      from vault.decrypted_secrets
      where name = ${SECRET_NAME}
      order by updated_at desc
      limit 1
    `;
    if (existing[0]) {
      await sql`
        select vault.update_secret(
          ${existing[0].id}::uuid, ${secret}, ${SECRET_NAME},
          ${"Command Centre Yeastar integration scheduler authorization"}
        )
      `;
    } else {
      await sql`
        select vault.create_secret(
          ${secret}, ${SECRET_NAME},
          ${"Command Centre Yeastar integration scheduler authorization"}
        )
      `;
    }

    await sql`
      select cron.unschedule(jobid)
      from cron.job
      where jobname in (
        'command-centre-yeastar-process',
        'command-centre-yeastar-reconcile'
      )
    `;
    const processCommand = cronCommand(`${origin}/api/internal/yeastar/process`);
    const reconcileCommand = cronCommand(`${origin}/api/internal/yeastar/reconcile`);
    await sql`
      select cron.schedule(
        ${"command-centre-yeastar-process"}, ${"* * * * *"}, ${processCommand}
      )
    `;
    await sql`
      select cron.schedule(
        ${"command-centre-yeastar-reconcile"}, ${"*/5 * * * *"}, ${reconcileCommand}
      )
    `;
    return {
      jobs: [
        { name: "command-centre-yeastar-process", schedule: "* * * * *" },
        { name: "command-centre-yeastar-reconcile", schedule: "*/5 * * * *" },
      ],
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function cronCommand(endpoint: string) {
  const safeEndpoint = endpoint.replaceAll("'", "''");
  return `
    select net.http_get(
      url := '${safeEndpoint}',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || coalesce((
          select decrypted_secret
          from vault.decrypted_secrets
          where name = '${SECRET_NAME}'
          order by updated_at desc
          limit 1
        ), '')
      ),
      timeout_milliseconds := 30000
    ) as request_id;
  `;
}

import postgres from "postgres";

import { getServerlessPostgresOptions } from "@/server/database/postgres-options";

const JOB_NAME = "command-centre-integration-recovery";
const SECRET_NAME = "command_centre_integration_cron_secret";
const SCHEDULE = "* * * * *";

type PostgresFactory = typeof postgres;

export async function configureIntegrationScheduler({
  connect = postgres,
  databaseUrl,
  endpointUrl,
  secret,
}: {
  connect?: PostgresFactory;
  databaseUrl: string;
  endpointUrl: string;
  secret: string;
}) {
  const endpoint = new URL(endpointUrl);
  if (endpoint.protocol !== "https:") {
    throw new Error("The integration scheduler endpoint must use HTTPS.");
  }
  if (!secret.trim()) {
    throw new Error("The integration scheduler secret is required.");
  }

  const sql = connect(databaseUrl, getServerlessPostgresOptions());
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
          ${existing[0].id}::uuid,
          ${secret},
          ${SECRET_NAME},
          ${"Command Centre integration recovery authorization"}
        )
      `;
    } else {
      await sql`
        select vault.create_secret(
          ${secret},
          ${SECRET_NAME},
          ${"Command Centre integration recovery authorization"}
        )
      `;
    }

    const rows = await sql<Array<{ jobId: number }>>`
      select cron.schedule(
        ${JOB_NAME},
        ${SCHEDULE},
        ${buildIntegrationCronCommand(endpoint.toString())}
      )::integer as "jobId"
    `;
    return { jobId: rows[0]?.jobId, jobName: JOB_NAME, schedule: SCHEDULE };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export function buildIntegrationCronCommand(endpointUrl: string) {
  const endpoint = new URL(endpointUrl);
  if (endpoint.protocol !== "https:") {
    throw new Error("The integration scheduler endpoint must use HTTPS.");
  }
  const escapedEndpoint = endpoint.toString().replaceAll("'", "''");
  return `
    select net.http_post(
      url := '${escapedEndpoint}',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || coalesce(
          (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = '${SECRET_NAME}'
            order by updated_at desc
            limit 1
          ),
          ''
        ),
        'Content-Type',
        'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 45000
    ) as request_id;
  `;
}

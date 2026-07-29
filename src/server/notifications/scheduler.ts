import postgres from "postgres";

import { getServerlessPostgresOptions } from "@/server/database/postgres-options";

const JOB_NAME = "command-centre-technician-notifications";
const SECRET_NAME = "command_centre_cron_secret";

export async function configureNotificationScheduler({
  databaseUrl,
  endpointUrl,
  secret,
}: {
  databaseUrl: string;
  endpointUrl: string;
  secret: string;
}) {
  const endpoint = new URL(endpointUrl);
  if (endpoint.protocol !== "https:") {
    throw new Error("The notification scheduler endpoint must use HTTPS.");
  }

  const sql = postgres(databaseUrl, getServerlessPostgresOptions());

  try {
    await sql.unsafe("create extension if not exists pg_net with schema extensions");
    await sql.unsafe("create extension if not exists pg_cron with schema pg_catalog");

    const existingSecrets = await sql<Array<{ id: string }>>`
      select id::text as id
      from vault.decrypted_secrets
      where name = ${SECRET_NAME}
      order by updated_at desc
      limit 1
    `;

    if (existingSecrets[0]) {
      await sql`
        select vault.update_secret(
          ${existingSecrets[0].id}::uuid,
          ${secret},
          ${SECRET_NAME},
          ${"Command Centre notification scheduler authorization"}
        )
      `;
    } else {
      await sql`
        select vault.create_secret(
          ${secret},
          ${SECRET_NAME},
          ${"Command Centre notification scheduler authorization"}
        )
      `;
    }

    const command = buildNotificationCronCommand(endpoint.toString());
    const rows = await sql<Array<{ jobId: number }>>`
      select cron.schedule(
        ${JOB_NAME},
        ${"* * * * *"},
        ${command}
      )::integer as "jobId"
    `;

    return {
      jobId: rows[0]?.jobId,
      jobName: JOB_NAME,
      schedule: "* * * * *",
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export function buildNotificationCronCommand(endpointUrl: string) {
  const escapedEndpoint = endpointUrl.replaceAll("'", "''");

  return `
    select net.http_get(
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
        )
      ),
      timeout_milliseconds := 30000
    ) as request_id;
  `;
}

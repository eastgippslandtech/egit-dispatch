import type postgres from "postgres";

import { getSharedPostgresClient } from "@/server/database/client";

import type { RequestWorkflow } from "./service-workflow";

export type RequestWorkflowAuditAction =
  | "template_applied"
  | "template_replaced"
  | "track_item_updated";

export interface RequestWorkflowRepository {
  get(requestId: string): Promise<RequestWorkflow | null>;
  save(
    workflow: RequestWorkflow,
    event: {
      action: RequestWorkflowAuditAction;
      actorEmail: string;
      details?: Record<string, unknown>;
    },
  ): Promise<void>;
}

let singleton: RequestWorkflowRepository | undefined;

export function getConfiguredRequestWorkflowRepository(
  databaseUrl = process.env.DATABASE_URL,
): RequestWorkflowRepository | null {
  if (!databaseUrl?.trim()) return null;
  singleton ??= createPostgresRequestWorkflowRepository({ databaseUrl });
  return singleton;
}

export function createPostgresRequestWorkflowRepository({
  databaseUrl = process.env.DATABASE_URL,
  sql = getSql(databaseUrl),
}: {
  databaseUrl?: string;
  sql?: postgres.Sql;
} = {}): RequestWorkflowRepository {
  return {
    async get(requestId) {
      const rows = await sql<Array<{ workflow: RequestWorkflow }>>`
        select workflow
        from public.request_workflows
        where request_id = ${requestId}
        limit 1
      `;
      return rows[0]?.workflow ?? null;
    },

    async save(workflow, event) {
      await sql.begin(async (transaction) => {
        await transaction`
          insert into public.request_workflows (
            request_id,
            template_id,
            template_version,
            template_name,
            classification_source,
            classification_confidence,
            workflow,
            applied_by_email,
            applied_at,
            updated_at
          ) values (
            ${workflow.requestId},
            ${workflow.templateId},
            ${workflow.templateVersion},
            ${workflow.templateName},
            ${workflow.classification.source},
            ${workflow.classification.confidence},
            ${transaction.json(workflow)},
            ${workflow.appliedByEmail},
            ${workflow.appliedAt},
            ${workflow.updatedAt}
          )
          on conflict (request_id) do update set
            template_id = excluded.template_id,
            template_version = excluded.template_version,
            template_name = excluded.template_name,
            classification_source = excluded.classification_source,
            classification_confidence = excluded.classification_confidence,
            workflow = excluded.workflow,
            applied_by_email = excluded.applied_by_email,
            applied_at = excluded.applied_at,
            updated_at = excluded.updated_at
        `;
        await transaction`
          insert into public.request_workflow_audit_events (
            request_id,
            action,
            actor_email,
            details
          ) values (
            ${workflow.requestId},
            ${event.action},
            ${event.actorEmail},
            ${transaction.json((event.details ?? {}) as never)}
          )
        `;
      });
    },
  };
}

function getSql(databaseUrl?: string) {
  if (!databaseUrl?.trim()) {
    throw new Error("DATABASE_URL is required for request workflows.");
  }
  return getSharedPostgresClient(databaseUrl);
}

# Integration Recovery Runbook

## Purpose

This runbook covers Command Centre's durable writeback queue for MSP Central, Outlook, and Command Centre state. It is for approved dispatch/admin operators and deployment owners. It does not authorize production provider changes outside designated test requests.

Production endpoints use `https://command.egit.com.au` only. Vercel preview deployments are for UI/build review and do not require working Zoho OAuth callbacks.

## Architecture

1. A protected Command Centre API validates user intent.
2. The local state change and durable integration operation are committed together where required.
3. The UI closes immediately and shows `Syncing`.
4. An immediate wake-up calls the protected worker.
5. A Supabase `pg_cron` recovery job calls the same worker every minute.
6. The worker leases the next ordered step, calls its server-side adapter, stores a bounded result, updates connector health, and appends an audit event.
7. Provider identifiers are reconciled into Command Centre before the operation becomes `Synced`.

Browser and mobile clients never receive service OAuth tokens, `DATABASE_URL`, `INTEGRATION_CRON_SECRET`, Supabase service-role credentials, or raw provider payloads.

## Operation states

| State | Meaning | Operator action |
| --- | --- | --- |
| `queued` | Accepted locally and waiting for the worker | Usually none |
| `syncing` | A worker has an active lease | Wait; do not cancel or replay |
| `retrying` | A safe retry is scheduled | Monitor connector health |
| `synced` | Every required step succeeded | None |
| `review_required` | Automatic continuation is unsafe or invalid | Review provider state, then Retry or Cancel |
| `cancelled` | Remaining unsynced work was deliberately abandoned | Confirm the local/provider result is acceptable |

Steps execute in declared order. A later provider is not called while an earlier step is unfinished. Multi-provider work is not reported as synced until all steps succeed.

## Connector health

Open `https://command.egit.com.au/integrations` while signed in as approved staff.

| Status | Meaning |
| --- | --- |
| Connected | Recent reads/writes are succeeding |
| Degraded | A retryable or ambiguous provider failure occurred |
| Unavailable | The connector cannot currently be reached |
| Authentication required | Service authorization was rejected or expired |
| Stale | No sufficiently recent successful activity is recorded |

The screen shows pending/review counts, safe error summaries, affected requests, and Retry/Cancel controls. Error summaries are intentionally bounded and must not contain headers, tokens, or full provider payloads.

## Retry and ambiguity policy

Safe idempotent failures retry with increasing delays of approximately 1, 5, 15, 60, and 360 minutes. Jitter may adjust the exact time.

Non-idempotent writes such as Work Logs, customer messages, request creation, and merges must not be blindly repeated after an uncertain timeout. The adapter first attempts provider-side reconciliation using the stored fingerprint and provider identifiers. If success cannot be proven, the action becomes `Review required`.

For an ambiguous Work Log:

1. Open the affected request in MSP Central.
2. Compare technician, rounded duration, start/end time, billable type, and normalized content.
3. If the Work Log exists, do not submit another copy. Record/reconcile the provider result through the supported recovery path.
4. If absence is proven and the underlying fault is corrected, use **Confirm absent and retry** once.
5. If neither outcome can be proven, leave it in review and escalate to an application owner.

An expired worker lease also becomes `Review required`; it is never automatically replayed because the provider may have accepted the interrupted write.

## Manual Retry and Cancel

Use the controls on `https://command.egit.com.au/integrations`.

- **Retry** is available only for review-required work. Correct the configuration or data issue first. The same idempotency identity and reconciliation requirement are retained, so ambiguous writes are reconciled rather than replayed.
- **Confirm absent and retry** is the only action that clears an ambiguous-write reconciliation requirement. Use it only after checking the provider and proving that no matching record exists.
- **Cancel** is available only when no step has an active lease and the operation is not already synced. Cancellation does not undo a provider write that already succeeded.
- Both actions record the signed-in operator in the audit timeline.

Never work around a failed action by manually repeating the same Work Log, message, booking, request creation, or merge without first checking the operation and provider state.

## Safe service-token rotation

Keep Command Centre login OAuth separate from MSP Central and Microsoft Graph service credentials.

1. Create or authorize the replacement credential in the provider using the existing approved scopes.
2. Store it directly in the production environment's encrypted secret manager. Do not paste it into source files, tickets, chat, screenshots, shell history, or this runbook.
3. Confirm the variable name is unchanged. Do not expose it with a `NEXT_PUBLIC_` prefix.
4. Redeploy or restart the server environment so new invocations receive the value.
5. Run a read-only health check first.
6. Use one designated test request for the relevant controlled write.
7. Confirm connector health returns to Connected and the action reaches Synced once.
8. Revoke the old credential only after verification.

If rotating `INTEGRATION_CRON_SECRET`, update the production environment first, redeploy, then call scheduler setup once. The scheduler route updates the Supabase Vault entry without returning the secret.

## Migration order

Inspect linked migration state and apply all pending migrations in timestamp order. The reliability foundation depends on:

1. `20260801103000_worklog_disposition_operations.sql`
2. `20260802120000_worklog_disposition_operation_migration_links.sql`
3. `20260803101626_integration_operations.sql`
4. `20260803103000_worklog_disposition_operation_migration_fk.sql`
5. `20260803235500_integration_worker_operations.sql`

Use the linked Supabase project from the repository root:

```powershell
pnpm supabase migration list --linked
pnpm supabase db push --dry-run
pnpm supabase db push
```

Do not enable writes if migration order, RLS, grants, indexes, or foreign keys differ from the repository migrations.

## Scheduler setup and verification

Required production server variables:

```text
APP_BASE_URL=https://command.egit.com.au
DATABASE_URL=<server-side pooled database URL>
INTEGRATION_CRON_SECRET=<separate random secret>
```

Keep the secret in the environment and send it through an authorization header without printing it:

```powershell
$headers = @{ Authorization = "Bearer $env:INTEGRATION_CRON_SECRET" }
Invoke-RestMethod -Method Post -Uri "https://command.egit.com.au/api/internal/integrations/scheduler" -Headers $headers
Invoke-RestMethod -Method Post -Uri "https://command.egit.com.au/api/internal/integrations/process" -Headers $headers -ContentType "application/json" -Body '{"limit":1}'
```

Expected scheduler metadata:

- Job name: `command-centre-integration-recovery`
- Schedule: every minute (`* * * * *`)
- Worker URL: `https://command.egit.com.au/api/internal/integrations/process`

Verification:

1. Confirm scheduler setup returns only job ID/name/schedule metadata.
2. Confirm an unauthorized worker request returns `401`.
3. Confirm an authorized bounded worker request returns claimed/succeeded/retrying/review counts without secret material.
4. Inspect `https://command.egit.com.au/integrations` after at least two minutes.
5. Confirm connector timestamps move and a controlled queued action advances without manual page refresh.

## Emergency disable and recovery

Use emergency disable when a provider is receiving duplicates, authentication is broadly compromised, or write payloads are wrong.

1. Stop staff from initiating the affected action and record the incident time.
2. Unschedule `command-centre-integration-recovery` in the Supabase SQL editor using the job name; do not delete operation/audit rows.
3. Remove or disable `INTEGRATION_CRON_SECRET` in the production environment if integration recovery calls must stop completely, then redeploy. The integration worker does not fall back to the legacy `CRON_SECRET`.
4. Inspect all `syncing`, `retrying`, and `review_required` operations. Treat active/expired leases as ambiguous until provider state is checked.
5. Correct code, mappings, credentials, or provider configuration.
6. Verify automated tests and a read-only health check.
7. Restore `INTEGRATION_CRON_SECRET`, call scheduler setup once, and process a batch limit of one.
8. Confirm one controlled action reconciles without duplication before restoring normal processing.
9. Monitor `/integrations` and audit events through at least two scheduler cycles.

Never truncate the operation, step, health, or audit tables as a recovery shortcut.

## Controlled provider test checklist

Use designated non-customer test requests only. Record request IDs and expected outcomes in the release change record, not in source control.

- [ ] One new schedule updates MSP Central and creates exactly one Outlook event.
- [ ] One reschedule updates the stored Outlook event instead of creating a replacement.
- [ ] One Work Log appears once with the correct technician, rounded 15-minute time, work type, and visibility.
- [ ] One customer Comms entry is customer-visible and appears once.
- [ ] One internal note remains internal and appears once.
- [ ] One merge removes the duplicate child and refreshes both child and parent views.
- [ ] A forced safe retry reaches Synced without repeating the already-successful provider step.
- [ ] A forced ambiguous Work Log reaches Review required and is not automatically replayed.
- [ ] Retry, Confirm absent and retry, and Cancel are permission-gated and add audit events.
- [ ] Dispatch closes accepted dialogs immediately, shows Syncing, then Synced or Review required.
- [ ] Browser verification at 1920x1080 finds no page-level overflow or unreadable overlap.

## Release evidence

Automated release evidence must include fresh results for `pnpm test`, `pnpm lint`, and `pnpm build`. Automated tests are deterministic, exercise the repository through an in-memory SQL boundary, and perform no live provider or production database writes.

Live migration, scheduler, browser, and controlled-provider evidence must be recorded separately by the deployment owner. Do not claim those checks from local automated results.

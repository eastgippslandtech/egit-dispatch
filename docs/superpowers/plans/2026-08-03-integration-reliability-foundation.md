# Command Centre Integration Reliability Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace separate best-effort scheduling, Work Log, merge, and Comms write paths with one durable, idempotent, observable operation system that responds immediately and safely recovers from provider failures.

**Architecture:** Store operations, provider steps, audit events, and connector health in server-only Supabase Postgres tables. Protected Next.js routes enqueue work and return `202`; a cron-authorized worker claims due steps with leases, invokes server-side provider adapters, reconciles ambiguous writes, and records success, retry, authentication failure, or manual-review state. Browser and native clients remain provider-credential-free and poll protected status APIs while work is pending.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, PostgreSQL via `postgres`, Supabase migrations/Postgres, Vercel/Next.js `after`, `pg_cron` recovery scheduling, existing MSP Central and Microsoft Graph clients.

## Global Constraints

- MSP Central Helpdesk, Microsoft Outlook, Zoho CRM, MSP Central Endpoint, and Zoho Survey remain systems of record.
- Provider credentials and Supabase service credentials remain server-side.
- The browser and native app call protected Command Centre APIs only.
- Every mutation has one stable idempotency key reused across retries.
- Never blindly retry an ambiguous non-idempotent provider write; reconcile it or mark it `review_required`.
- Never store refresh tokens, authorization headers, or complete provider payloads in audit events.
- Existing uncommitted Day One hardening changes in this worktree must be preserved and incorporated.
- Existing Work Log duration rounding remains upward to 15-minute increments.
- UI acknowledgement is immediate and truthfully shows `Syncing`, `Retrying`, or `Review required` until provider completion.
- All new public-schema tables enable RLS, revoke `anon` and `authenticated`, and grant only `service_role` access.

---

## File Structure

Create a focused `src/server/integrations/` module:

- `types.ts` - operation, step, connector, health, and audit contracts.
- `errors.ts` - retryable, authentication, permanent, and ambiguous provider errors.
- `fingerprint.ts` - stable payload serialization and SHA-256 fingerprints.
- `repository.ts` - Postgres operation, lease, audit, and health persistence.
- `processor.ts` - lease-based step execution and retry decisions.
- `registry.ts` - maps step action names to provider adapters.
- `operations.ts` - builders for schedule, Work Log, Comms, and merge operations.
- `scheduler.ts` - recovery cron setup using the existing secured scheduler pattern.

Add protected routes under `src/app/api/internal/integrations/` for processing, scheduling, health, action review, retry, and cancellation. Add `/integrations` as the admin/dispatch operational health screen.

### Task 1: Durable Integration Schema

**Files:**
- Create via CLI: `supabase migration new integration_operations`
- Modify generated migration: `supabase/migrations/*_integration_operations.sql`
- Create: `src/server/integrations/schema.test.ts`

**Interfaces:**
- Produces tables `integration_operations`, `integration_operation_steps`, `integration_audit_events`, and `integration_connector_health`.
- Produces operation states `queued | syncing | retrying | synced | review_required | cancelled`.
- Produces step states `queued | processing | retrying | succeeded | review_required | cancelled`.

- [ ] **Step 1: Generate the migration through the Supabase CLI**

Run:

```powershell
pnpm supabase migration new integration_operations
```

Expected: one new empty `*_integration_operations.sql` file.

- [ ] **Step 2: Write a failing schema contract test**

Create `src/server/integrations/schema.test.ts` that locates the generated migration and asserts it contains all four tables, unique `idempotency_key`, unique `(operation_id, step_key)`, lease fields, retry fields, RLS, role revocations, and partial due-step indexes.

```ts
expect(sql).toContain("create table public.integration_operations");
expect(sql).toContain("idempotency_key text not null unique");
expect(sql).toContain("create table public.integration_operation_steps");
expect(sql).toContain("unique (operation_id, step_key)");
expect(sql).toContain("lease_expires_at timestamptz");
expect(sql).toContain("alter table public.integration_operations enable row level security");
```

- [ ] **Step 3: Run the schema test and verify failure**

Run: `pnpm vitest run src/server/integrations/schema.test.ts`

Expected: FAIL because the migration is empty.

- [ ] **Step 4: Implement the migration**

Use UUID primary keys and JSONB payloads. `integration_operations` stores action-level identity and state. `integration_operation_steps` stores ordered provider work and its lease/retry/result state. `integration_audit_events` stores sanitised history. `integration_connector_health` stores one row per connector.

Required constraints:

```sql
check (state in ('queued','syncing','retrying','synced','review_required','cancelled'))
check (connector in ('command_centre','msp_central','outlook','zoho_crm','msp_endpoint','zoho_survey','push','email'))
check (attempt_count >= 0)
unique (operation_id, step_key)
```

Add partial indexes for due steps where state is `queued` or `retrying`, request audit history by `(request_id, created_at desc)`, failed actions, and connector health freshness. Enable RLS and remove browser roles from all tables.

- [ ] **Step 5: Verify the schema**

Run:

```powershell
pnpm vitest run src/server/integrations/schema.test.ts
pnpm supabase db lint --local
```

Expected: PASS. If local Supabase is unavailable, record that limitation and run the migration against the linked development database before production.

- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations src/server/integrations/schema.test.ts
git commit -m "feat: add durable integration operation schema"
```

### Task 2: Integration Domain And Repository

**Files:**
- Create: `src/server/integrations/types.ts`
- Create: `src/server/integrations/fingerprint.ts`
- Create: `src/server/integrations/fingerprint.test.ts`
- Create: `src/server/integrations/repository.ts`
- Create: `src/server/integrations/repository.test.ts`

**Interfaces:**
- Consumes the four tables from Task 1 and `getSharedPostgresClient()`.
- Produces `IntegrationRepository` with `enqueue`, `claimDueSteps`, `markStepSucceeded`, `markStepFailed`, `retryOperation`, `cancelOperation`, `listOperations`, `getHealth`, `recordConnectorRead`, and `appendAudit`.
- Produces `fingerprintPayload(value: unknown): string`.

- [ ] **Step 1: Write fingerprint tests**

Test that object key order does not change a fingerprint and semantically different payloads do.

```ts
expect(fingerprintPayload({ b: 2, a: 1 })).toBe(
  fingerprintPayload({ a: 1, b: 2 }),
);
expect(fingerprintPayload({ a: 1 })).not.toBe(fingerprintPayload({ a: 2 }));
```

- [ ] **Step 2: Implement stable SHA-256 fingerprinting**

Recursively sort object keys, preserve array order, serialize with JSON, and hash with `node:crypto`. Do not log the source payload.

- [ ] **Step 3: Define exact domain contracts**

```ts
export type IntegrationConnector =
  | "command_centre" | "msp_central" | "outlook" | "zoho_crm"
  | "msp_endpoint" | "zoho_survey" | "push" | "email";

export type EnqueueIntegrationOperation = {
  actionType: string;
  actorEmail: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  requestId?: string;
  sourceVersion?: string;
  steps: Array<{
    action: string;
    connector: IntegrationConnector;
    payload: Record<string, unknown>;
    stepKey: string;
  }>;
};
```

- [ ] **Step 4: Write repository tests with a deterministic fake SQL adapter**

Cover new enqueue, exact replay, conflicting key reuse, ordered step creation, lease claim, succeeded step, retry scheduling, review-required transition, cancellation, and sanitised audit insertion.

- [ ] **Step 5: Implement the Postgres repository**

Use one transaction for operation plus steps. On idempotency conflict, compare payload fingerprints and reject different work. Claim steps with `FOR UPDATE SKIP LOCKED`, set `worker_id` and `lease_expires_at`, and never claim completed/review/cancelled steps.

- [ ] **Step 6: Run focused tests**

Run: `pnpm vitest run src/server/integrations/fingerprint.test.ts src/server/integrations/repository.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/server/integrations
git commit -m "feat: add integration operation repository"
```

### Task 3: Retry-Safe Operation Processor

**Files:**
- Create: `src/server/integrations/errors.ts`
- Create: `src/server/integrations/processor.ts`
- Create: `src/server/integrations/processor.test.ts`
- Create: `src/server/integrations/registry.ts`

**Interfaces:**
- Consumes `IntegrationRepository` from Task 2.
- Produces `IntegrationStepAdapter.execute(step): Promise<IntegrationStepResult>`.
- Produces `createIntegrationProcessor({ repository, registry, clock, workerId }).processDue({ limit })`.

- [ ] **Step 1: Write failure-classification tests**

Cover network/429/5xx retry, 401/403 authentication-required, 400 validation review, 409/version conflict review, unknown post-write timeout ambiguous review, and expired lease recovery.

- [ ] **Step 2: Define explicit provider error classes**

```ts
export class RetryableIntegrationError extends Error { code = "retryable"; }
export class AuthenticationIntegrationError extends Error { code = "authentication_required"; }
export class PermanentIntegrationError extends Error { code = "permanent"; }
export class AmbiguousIntegrationError extends Error { code = "ambiguous"; }
```

- [ ] **Step 3: Write processor tests**

Assert step order, completed-step skipping, exponential retry dates, operation-level state rollup, connector health updates, audit entries, and that ambiguous writes never auto-retry.

- [ ] **Step 4: Implement processor and registry**

Use retry delays of 1, 5, 15, 60, and 360 minutes with deterministic jitter injection for tests. A successful step records external ID/version when supplied. Authentication errors update connector health to `authentication_required`. A permanent or ambiguous error marks the step and operation `review_required`.

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run src/server/integrations/processor.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/server/integrations
git commit -m "feat: process retry-safe integration operations"
```

### Task 4: Provider Operation Builders And Adapters

**Files:**
- Create: `src/server/integrations/operations.ts`
- Create: `src/server/integrations/operations.test.ts`
- Create: `src/server/integrations/adapters/msp-central.ts`
- Create: `src/server/integrations/adapters/msp-central.test.ts`
- Create: `src/server/integrations/adapters/outlook.ts`
- Create: `src/server/integrations/adapters/outlook.test.ts`
- Create: `src/server/integrations/adapters/command-centre.ts`
- Modify: `src/server/msp-central/client.ts`
- Modify: `src/server/msp-central/client.test.ts`

**Interfaces:**
- Consumes existing MSP Central, Graph, dispatch-link, request-snapshot, Work Log, and Comms clients.
- Produces operation builders `scheduleOperation`, `worklogOperation`, `communicationOperation`, and `mergeOperation`.
- Produces registry actions `msp.*`, `outlook.*`, and `command_centre.*`.

- [ ] **Step 1: Write operation-builder tests**

Schedule steps must include MSP assignment/schedule, lead and crew Outlook upserts, obsolete Outlook cleanup, dispatch-link persistence, and refresh invalidation. Work Log steps must preserve Work Log-before-disposition ordering. Customer Comms must set requester visibility; internal Comms must not.

- [ ] **Step 2: Implement deterministic operation builders**

Step keys must be stable, for example `msp:schedule`, `outlook:lead:<technicianId>`, `outlook:crew:<technicianId>`, and `command:link`. Do not derive keys from array indexes.

- [ ] **Step 3: Add MSP reconciliation reads**

Extend the MSP Central client with request Work Log and note reads needed to reconcile ambiguous writes. Compare request ID, technician/owner, rounded duration, time window, visibility, and a local content fingerprint. If MSP Central cannot prove whether a timed-out write succeeded, raise `AmbiguousIntegrationError` rather than creating a duplicate.

- [ ] **Step 4: Implement MSP Central adapters**

Map provider HTTP failures into the error classes from Task 3. Schedule/status updates are retried only when the desired state can be safely re-applied. Merge ambiguity is reconciled using source/parent request state or marked for review.

- [ ] **Step 5: Implement Outlook adapters**

Use Graph `transactionId` for creates. Reuse stored event IDs for updates/deletes. Treat a returning Command Centre-created Outlook event as the same booking, not a double booking.

- [ ] **Step 6: Implement Command Centre adapters**

Persist dispatch links, provider IDs, audit-safe summaries, and a refresh-invalidation event. This adapter is the final step for successful multi-provider scheduling.

- [ ] **Step 7: Run adapter tests**

Run:

```powershell
pnpm vitest run src/server/integrations/operations.test.ts src/server/integrations/adapters src/server/msp-central/client.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/server/integrations src/server/msp-central
git commit -m "feat: add schedule and Helpdesk integration adapters"
```

### Task 5: Enqueue Existing Mutations

**Files:**
- Modify: `src/app/api/internal/dispatch/live-schedule/route.ts`
- Modify: `src/app/api/internal/dispatch/live-schedule/route.test.ts`
- Modify: `src/app/api/internal/msp-central/worklogs/route.ts`
- Create: `src/app/api/internal/msp-central/worklogs/route.test.ts`
- Modify: `src/app/api/internal/msp-central/requests/[requestId]/communications/route.ts`
- Modify: `src/app/api/internal/msp-central/requests/[requestId]/communications/route.test.ts`
- Modify: `src/app/api/internal/msp-central/merge-requests/route.ts`
- Modify: `src/app/api/internal/msp-central/merge-requests/route.test.ts`
- Modify: `src/server/worklogs/repository.ts`
- Modify: `src/server/worklogs/processor.ts`

**Interfaces:**
- Consumes operation builders/repository from Tasks 2-4.
- Produces consistent `202` responses `{ operationId, status: "queued" }`.
- Preserves existing request validation and access control.

- [ ] **Step 1: Update route tests to expect immediate enqueue**

Assert authentication, validation, operation payload, stable idempotency key, `202`, and no direct provider call before the response.

- [ ] **Step 2: Refactor live scheduling**

Persist the local booking first, enqueue `scheduleOperation`, call `after()` only as a best-effort immediate worker wake-up, and return `202`. The durable row, not `after()`, guarantees recovery.

- [ ] **Step 3: Refactor Work Logs**

Validate and resolve the Work Log owner, enqueue ordered Work Log/disposition steps, and return immediately. Preserve compatibility reads for existing `worklog_disposition_operations`; migrate incomplete legacy operations into the generic queue once, keyed by their existing idempotency key.

- [ ] **Step 4: Refactor Comms and merge**

Enqueue customer/internal Comms and merge operations. Outbound self-authored Comms continue to set `notify_technician: false`. Merge keeps the selected parent and removes the clicked duplicate only after provider confirmation.

- [ ] **Step 5: Run route and Work Log tests**

Run:

```powershell
pnpm vitest run src/app/api/internal/dispatch/live-schedule/route.test.ts src/app/api/internal/msp-central src/server/worklogs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app/api/internal src/server/worklogs
git commit -m "feat: queue Command Centre provider writes"
```

### Task 6: Worker, Recovery Scheduler, And Protected APIs

**Files:**
- Create: `src/app/api/internal/integrations/process/route.ts`
- Create: `src/app/api/internal/integrations/process/route.test.ts`
- Create: `src/app/api/internal/integrations/scheduler/route.ts`
- Create: `src/app/api/internal/integrations/scheduler/route.test.ts`
- Create: `src/app/api/internal/integrations/health/route.ts`
- Create: `src/app/api/internal/integrations/health/route.test.ts`
- Create: `src/app/api/internal/integrations/actions/route.ts`
- Create: `src/app/api/internal/integrations/actions/route.test.ts`
- Create: `src/app/api/internal/integrations/actions/[operationId]/retry/route.ts`
- Create: `src/app/api/internal/integrations/actions/[operationId]/cancel/route.ts`
- Create: `src/server/integrations/scheduler.ts`
- Create: `src/server/integrations/scheduler.test.ts`

**Interfaces:**
- Consumes processor/repository from Tasks 2-5 and existing `cronAuthorized`, `staffRouteAccess`, and `adminRouteAccess` patterns.
- Produces cron worker and protected operational APIs.

- [ ] **Step 1: Write authorization tests**

Worker/scheduler require `INTEGRATION_CRON_SECRET` or `CRON_SECRET`. Health requires approved staff. Failed-action list, retry, and cancel require admin/dispatch authorization.

- [ ] **Step 2: Implement process endpoint**

Claim a bounded batch, process it, and return counts for succeeded, retrying, review-required, and remaining due work. Set `runtime = "nodejs"` and `Cache-Control: no-store`.

- [ ] **Step 3: Implement scheduler using the existing pg_cron/Vault/net pattern**

Schedule `/api/internal/integrations/process` every minute. Store the authorization secret in Vault and never include it in logs or responses.

- [ ] **Step 4: Implement health and failed-action APIs**

Return connector state, last read/write, pending/failed counts, and sanitised error summaries. Retry creates an audit event and resets only reviewable failed steps. Cancel refuses already-synced operations.

- [ ] **Step 5: Run API tests**

Run: `pnpm vitest run src/app/api/internal/integrations src/server/integrations/scheduler.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app/api/internal/integrations src/server/integrations/scheduler*
git commit -m "feat: add integration recovery worker and APIs"
```

### Task 7: Integration Health And Failed-Action UI

**Files:**
- Create: `src/app/integrations/page.tsx`
- Create: `src/app/integrations/page.test.tsx`
- Create: `src/app/integrations/integration-health.tsx`
- Create: `src/app/integrations/failed-actions.tsx`
- Modify: `src/app/dispatch/command-centre/prototype.tsx`
- Modify: `src/app/dispatch/command-centre/page.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes protected health/actions/retry/cancel APIs from Task 6.
- Produces the Integrations screen, compact global sync state, and truthful pending/review UI.

- [ ] **Step 1: Write UI tests**

Cover Connected/Degraded/Unavailable/Authentication required/Stale states, pending/failed counts, Retry, Cancel, opening the affected request, and no duplicate warning banners.

- [ ] **Step 2: Build the Integrations screen**

Use the locked Command Centre navy/orange design. Keep the screen operational and dense: connector table first, failed-action list second, audit summary last. Do not use marketing cards or decorative explanations.

- [ ] **Step 3: Add pending operation feedback to Dispatch**

After enqueue, close the scheduling/Work Log/Comms dialog immediately, show a short confirmation, and mark the request `Syncing`. Poll operation status every three seconds while pending, then return to the normal 30-second refresh interval. Show `Review required` with a link instead of a long-lived toast.

- [ ] **Step 4: Add navigation**

Add a restrained `Integrations` link for dispatch/admin users. Do not expose failed-action management on the wallboard.

- [ ] **Step 5: Run UI tests**

Run:

```powershell
pnpm vitest run src/app/integrations src/app/dispatch/command-centre/page.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app/integrations src/app/dispatch/command-centre src/app/globals.css
git commit -m "feat: add integration health and recovery console"
```

### Task 8: End-to-End Verification And Rollout

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Create: `docs/integration-recovery-runbook.md`
- Create: `src/server/integrations/end-to-end.test.ts`

**Interfaces:**
- Consumes all previous tasks.
- Produces production setup instructions, operator recovery procedures, and release evidence.

- [ ] **Step 1: Add end-to-end failure simulations**

Cover successful schedule, Graph succeeds/MSP retries, MSP succeeds/Graph retries, ambiguous Work Log, duplicate request replay, authentication expiry, worker interruption, merge refresh, and manual Retry/Cancel.

- [ ] **Step 2: Document configuration**

Document `DATABASE_URL`, `INTEGRATION_CRON_SECRET`, scheduler setup, health checks, retry policy, manual review, and safe token replacement. Do not add real secrets.

- [ ] **Step 3: Run complete automated verification**

Run:

```powershell
pnpm test
pnpm lint
pnpm build
```

Expected: all pass.

- [ ] **Step 4: Verify in browser at 1920x1080**

Confirm Dispatch remains usable, schedule confirmation closes immediately, Syncing changes to Synced, forced failures appear once, Integrations can Retry/Cancel, and there is no page-level overflow or unreadable overlap.

- [ ] **Step 5: Verify controlled provider writes**

Use designated test requests only. Confirm one Work Log, one customer Comms entry, one internal note, one schedule/Outlook booking, one reschedule, and one merge. Verify retries do not duplicate provider records.

- [ ] **Step 6: Configure and verify the recovery scheduler**

Call the protected scheduler route once in production, then confirm the process endpoint runs every minute and updates connector health without exposing the secret.

- [ ] **Step 7: Commit**

```powershell
git add .env.example README.md docs/integration-recovery-runbook.md src/server/integrations/end-to-end.test.ts
git commit -m "docs: add integration recovery operations guide"
```

- [ ] **Step 8: Deploy with the reliability feature enabled for approved staff**

Deploy production, verify `https://command.egit.com.au/dispatch` and `https://command.egit.com.au/integrations`, and monitor failed actions before beginning the Dispatch Queue slice.


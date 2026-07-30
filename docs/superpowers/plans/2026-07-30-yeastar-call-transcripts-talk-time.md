# Yeastar Call Transcripts and Talk-Time Implementation Plan

> **For Codex:** Execute this plan with the executing-plans workflow. Use TDD for
> domain logic and API behavior, preserve existing Dispatch/Wallboard behavior,
> and keep unconfigured integrations non-blocking.

**Goal:** Ingest answered external Yeastar calls and Yeastar AI transcripts,
attribute connected talk time to EGIT technicians, match callers to Zoho CRM,
and expose historical call activity in Command Centre and weekly totals on the
wallboard.

**Architecture:** Signed Yeastar webhooks enqueue completed calls in Supabase.
Scheduled Vercel routes process queued CDRs every minute and reconcile missed
CDRs every five minutes. Dispatch, call history, and wallboard render local
Supabase projections only. Yeastar and Zoho CRM credentials remain server-side
and separate from login, MSP Central, and existing Yeastar recording behavior.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Postgres/Supabase,
Supabase `pg_cron` and `pg_net`, Vitest, Vercel.

---

## Task 1: Domain Rules

**Files:**
- Create: `src/server/yeastar/types.ts`
- Create: `src/server/yeastar/phone.ts`
- Create: `src/server/yeastar/phone.test.ts`
- Create: `src/server/yeastar/talk-time.ts`
- Create: `src/server/yeastar/talk-time.test.ts`
- Create: `src/server/yeastar/webhook.ts`
- Create: `src/server/yeastar/webhook.test.ts`

- [ ] Write failing tests for Australian number normalization.
- [ ] Write failing tests for external answered-call eligibility, transferred
      segment attribution, duplicate prevention, Monday-based Melbourne week
      boundaries, and compact duration formatting.
- [ ] Write failing tests for HMAC-SHA256 webhook verification.
- [ ] Implement the minimal pure helpers and types.
- [ ] Run the focused tests and confirm they pass.

## Task 2: Server-Only Supabase Schema

**Files:**
- Create using CLI: `supabase/migrations/*_yeastar_call_reporting.sql`
- Update: `.env.example`

- [ ] Review current Supabase cron, `pg_net`, RLS, and security guidance.
- [ ] Create the migration with `supabase migration new`.
- [ ] Add call, segment, staff mapping, customer mapping, webhook event, token,
      sync-state, settings, and job-run tables with indexes and constraints.
- [ ] Enable RLS, revoke `anon`/`authenticated`, and grant server-only access.
- [ ] Add integration and retention environment placeholders.
- [ ] Validate the migration locally or with migration lint/dry-run tooling.

## Task 3: Persistence and Service Clients

**Files:**
- Create: `src/server/yeastar/config.ts`
- Create: `src/server/yeastar/repository.ts`
- Create: `src/server/yeastar/client.ts`
- Create: `src/server/yeastar/client.test.ts`
- Create: `src/server/yeastar/ingestion.ts`
- Create: `src/server/yeastar/ingestion.test.ts`
- Create: `src/server/zoho-crm/config.ts`
- Create: `src/server/zoho-crm/client.ts`
- Create: `src/server/zoho-crm/client.test.ts`
- Create: `src/server/zoho-crm/matching.ts`
- Create: `src/server/zoho-crm/matching.test.ts`

- [ ] Write failing Yeastar client tests for required headers, token refresh,
      CDR detail, transcript, summary, and safe errors.
- [ ] Implement token-coordinated Yeastar API client and Postgres repository.
- [ ] Write failing ingestion tests for internal/unanswered exclusions,
      idempotent segments, transfers, aggregate fallback, transcript retries,
      and no recording download/storage.
- [ ] Implement webhook/reconciliation ingestion and local projections.
- [ ] Write failing Zoho CRM tests for Contact-first, Account-second matching.
- [ ] Implement separate CRM service OAuth client and phone matching.

## Task 4: Routes and Scheduling

**Files:**
- Create: `src/app/api/integrations/yeastar/webhook/route.ts`
- Create: `src/app/api/integrations/yeastar/webhook/route.test.ts`
- Create: `src/app/api/internal/yeastar/process/route.ts`
- Create: `src/app/api/internal/yeastar/reconcile/route.ts`
- Create: `src/app/api/internal/yeastar/health/route.ts`
- Create: `src/app/api/internal/yeastar/scheduler/route.ts`
- Create: `src/app/api/internal/calls/route.ts`
- Create: `src/app/api/internal/calls/[callId]/route.ts`
- Create: `src/app/api/internal/calls/[callId]/retry/route.ts`
- Create: `src/server/yeastar/scheduler.ts`
- Create: `src/server/yeastar/scheduler.test.ts`

- [ ] Add signed, replay-safe webhook route with a quick response.
- [ ] Add cron-authorized processing and reconciliation routes.
- [ ] Add staff-protected read APIs and admin-protected mutation APIs.
- [ ] Add scheduler configuration for one-minute processing and five-minute
      reconciliation using Vault-backed authorization.
- [ ] Test unauthenticated, wallboard, staff, admin, replay, and disabled-config
      behavior.

## Task 5: Command Centre and Wallboard UI

**Files:**
- Update: `src/server/dispatch/types.ts`
- Update: `src/server/dispatch/database.ts`
- Update: `src/server/presence/types.ts`
- Update: `src/server/presence/service.ts`
- Update: `src/server/presence/service.test.ts`
- Update: `src/app/wallboard/wallboard-screen.tsx`
- Update: `src/app/wallboard/page.test.tsx`
- Update: `src/app/dispatch/command-centre/prototype.tsx`
- Create: `src/app/calls/page.tsx`
- Create: `src/app/calls/[callId]/page.tsx`
- Create: `src/app/settings/integrations/yeastar/page.tsx`
- Create: `src/app/settings/integrations/zoho-crm/page.tsx`

- [ ] Add read-only external-call activities to Day/Week calendars.
- [ ] Ensure call activities are never draggable or treated as appointments.
- [ ] Add weekly external talk time to each wallboard staff card.
- [ ] Keep transcript links unavailable to the wallboard-only account.
- [ ] Add searchable call history and safe transcript detail.
- [ ] Add admin-only integration status, sync, retry, and mapping views.
- [ ] Add focused UI tests for totals, call cards, access, and safe empty states.

## Task 6: Operations, Verification, and Deployment

**Files:**
- Update: `README.md`
- Update: `vercel.json` if needed

- [ ] Document Yeastar and Zoho CRM activation steps and capability checks.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm lint`.
- [ ] Run `pnpm build`.
- [ ] Apply the linked Supabase migration and run security/performance advisors.
- [ ] Configure cron jobs when `INTEGRATION_CRON_SECRET` is available.
- [ ] Deploy the production build to Vercel.
- [ ] Browser-verify Dispatch, Wallboard, Calls, and integration status screens.
- [ ] Confirm missing external credentials remain non-blocking and report the
      exact activation values still required.

# Technician Complete Job Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the complete authoritative Helpdesk request description, customer replies, internal notes, and Work Logs inside every native technician request, with reliable offline access.

**Architecture:** Enrich the existing database-backed mobile job endpoint with `MspCentralClient.getRequestContext`, normalize the three Helpdesk activity types into the existing `previousNotes` mobile field, and cache the enriched `MobileJob` unchanged in SQLite. Keep scheduling and operational state sourced from Command Centre, keep Helpdesk credentials server-side, and retain safe database/cache fallbacks.

**Tech Stack:** Next.js App Router, TypeScript, MSP Central REST API, Expo/React Native, SQLite cache, Vitest, React Test Renderer.

## Global Constraints

- Include customer replies, internal technician notes, and Work Logs.
- Display the original request description above the activity timeline.
- Order activity newest first and label every entry clearly.
- Preserve schedules, Outlook bookings, timers, Work Logs, charged travel time, notifications, completion, payments, and lunch.
- Keep MSP Central credentials server-side.
- Do not alter the locked Command Centre web design.
- Retain useful cached job content when live refresh fails.

---

### Task 1: Paginated Helpdesk Request Context

**Files:**
- Modify: `src/server/msp-central/types.ts`
- Modify: `src/server/msp-central/client.ts`
- Test: `src/server/msp-central/client.test.ts`

**Interfaces:**
- Consumes: existing authenticated `getJson<T>(url)` and MSP Central list endpoints.
- Produces: `getRequestContext(requestId): Promise<MspCentralRequestContext>` containing every available note and Work Log page.

- [ ] **Step 1: Write failing pagination tests**

Add a client test whose first notes and Work Log responses contain
`list_info.has_more_rows: true`, whose second pages contain `false`, and which
asserts that all four entries reach the returned context and that
`start_index` advances in each second request.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm vitest run src/server/msp-central/client.test.ts`

Expected: FAIL because `getRequestContext` currently requests only
`start_index: 1`.

- [ ] **Step 3: Add list metadata and a bounded page reader**

Add the shared list metadata to both response types:

```ts
type MspCentralListInfo = {
  has_more_rows?: boolean | string | null;
  row_count?: number | string | null;
  start_index?: number | string | null;
  total_count?: number | string | null;
};
```

Implement a private request-entry page loop that requests 100 rows at a time,
increments `start_index` by the returned item count, stops when
`has_more_rows` is false or a page is empty, and rejects a repeated start index
to prevent an upstream pagination fault from looping forever. Use it for both
notes and Work Logs inside the existing `Promise.allSettled` boundary.

- [ ] **Step 4: Run the focused client tests**

Run: `pnpm vitest run src/server/msp-central/client.test.ts`

Expected: PASS, including the existing partial notes/worklogs failure cases.

### Task 2: Typed Mobile Activity Contract and Server Enrichment

**Files:**
- Modify: `apps/technician-mobile/src/contracts/mobile.ts`
- Modify: `apps/technician-mobile/src/testing/fixtures.ts`
- Modify: `apps/technician-mobile/src/data/mock-technician-repository.ts`
- Modify: `apps/technician-mobile/src/features/worklogs/worklog-service.ts`
- Modify: `src/server/mobile-api/service.ts`
- Test: `src/server/mobile-api/service.test.ts`

**Interfaces:**
- Consumes: `MspCentralRequestContext` and the database job's exact `sdpRequestId`.
- Produces: `MobileJobNote` with `kind`, `durationMinutes`, and `isBillable`; `getMobileJob` accepts an injectable `mspClient` and returns an enriched `MobileJob`.

- [ ] **Step 1: Write failing mobile-service tests**

Inject an `MspCentralClient` whose `getRequestContext` returns a current request,
one customer response, one internal note, and two Work Logs. Assert:

```ts
expect(response.job.description).toBe("Current detailed job description.");
expect(response.job.previousNotes.map(({ kind }) => kind)).toEqual([
  "worklog",
  "internal_note",
  "customer_reply",
  "worklog",
]);
expect(response.job.previousNotes[0]).toMatchObject({
  durationMinutes: 45,
  isBillable: true,
});
```

Also assert `getRequestContext` receives `dbJob.sdpRequestId`, activity is
newest first, and database scheduling, technician, permissions, and job ID are
unchanged. Add cases for a missing client and a rejecting client.

- [ ] **Step 2: Run the focused service tests and verify they fail**

Run: `pnpm vitest run src/server/mobile-api/service.test.ts`

Expected: FAIL because `getMobileJob` does not yet request Helpdesk context and
`MobileJobNote` lacks activity metadata.

- [ ] **Step 3: Extend the shared activity type**

Add:

```ts
export type MobileJobActivityKind =
  | "customer_reply"
  | "internal_note"
  | "worklog";

export interface MobileJobNote {
  // existing fields remain
  kind: MobileJobActivityKind;
  durationMinutes: number | null;
  isBillable: boolean | null;
}

export interface MobileJob {
  // existing fields remain
  activityWarning: string | null;
}
```

Update fixture, mock repository, local Work Log, Outlook note, and database
sync-log creators with explicit safe values.

- [ ] **Step 4: Implement pure request-context enrichment**

Add a focused helper in `service.ts` that maps:

```ts
customerResponses -> kind: "customer_reply", visibility: "external"
internalNotes     -> kind: "internal_note", visibility: "internal"
worklogs          -> kind: "worklog", visibility based on isBillable
```

Convert absent optional Work Log values to `null`, use stable MSP IDs, sort by
`createdAt` descending, and merge fresh request fields without replacing the
database job's operational fields.

- [ ] **Step 5: Enrich database jobs with a safe fallback**

Add `mspClient = getConfiguredMobileMspClient()` to `getMobileJob`. For a
database job, call `getRequestContext(job.sdpRequestId)` and return the enriched
job. If the client is absent or the read throws, return `mapDatabaseJob(job)` so
the scheduled request still opens.

- [ ] **Step 6: Run contract and service tests**

Run: `pnpm vitest run src/server/mobile-api/service.test.ts apps/technician-mobile/src/features/worklogs/worklog-flow.test.tsx`

Expected: PASS with existing Work Log behavior unchanged.

### Task 3: Native Request Description and Full Activity Timeline

**Files:**
- Create: `apps/technician-mobile/src/features/jobs/job-activity.tsx`
- Modify: `apps/technician-mobile/src/features/jobs/job-detail.tsx`
- Test: `apps/technician-mobile/src/features/jobs/job-detail.test.tsx`

**Interfaces:**
- Consumes: `MobileJob.description` and `MobileJob.previousNotes` enriched in Task 2.
- Produces: `JobActivity({ entries }: { entries: MobileJobNote[] })` and refreshable `JobDetail` rendering.

- [ ] **Step 1: Write failing native rendering tests**

Create an enriched fixture and assert the screen contains `Request description`,
`Job activity`, `Customer reply`, `Internal note`, `Work Log`, author, formatted
Melbourne timestamp, `45 min`, `Billable`, and every activity body in newest-first
order. Add a legacy cached-entry case with missing metadata and an empty state.

- [ ] **Step 2: Write a failing non-destructive refresh test**

Use a repository that succeeds once and rejects on refresh. Assert cached
content remains rendered, the refresh indicator stops, and the screen displays
`Could not refresh job activity. Showing the saved copy.`

- [ ] **Step 3: Run the focused native test and verify it fails**

Run: `pnpm --filter @egit/technician-mobile test -- src/features/jobs/job-detail.test.tsx`

Expected: FAIL because the old screen labels all entries only by visibility and
has no refresh control.

- [ ] **Step 4: Build the focused activity component**

Render a card per entry with label and metadata helpers:

```ts
activityLabel(entry) // Customer reply | Internal note | Work Log
activityDetail(entry) // author · date/time · duration · billable/internal
```

Use `Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", ... })`
for dates and retain the complete plain-text body without truncation.

- [ ] **Step 5: Make job detail refreshable without blanking content**

Extract `loadJob({ refresh: boolean })`. The initial load retains the existing
loading/error states. Refresh leaves `job` rendered, passes `refreshing` and
`onRefresh` to `ScrollView`/`RefreshControl`, and converts refresh failures into
the non-blocking saved-copy message.

- [ ] **Step 6: Restructure only the native detail content**

Move description into `Request description`, replace `Latest ticket notes`
with `JobActivity`, and leave actions, timers, payment, Work Log, customer/site,
and service context behavior intact.

- [ ] **Step 7: Run the focused native tests**

Run: `pnpm --filter @egit/technician-mobile test -- src/features/jobs/job-detail.test.tsx src/features/worklogs/worklog-flow.test.tsx`

Expected: PASS.

### Task 4: Offline Cache Regression Coverage

**Files:**
- Test: `apps/technician-mobile/src/data/offline-technician-repository.test.ts`
- Modify only if a test exposes a defect: `apps/technician-mobile/src/data/offline-technician-repository.ts`

**Interfaces:**
- Consumes: enriched `MobileJob` returned by the remote repository.
- Produces: identical enriched activity after an offline SQLite read.

- [ ] **Step 1: Write the enriched offline-cache test**

Return a job containing all three activity kinds from the remote, read it once,
then make the remote fail and read it again. Assert the offline result preserves
every entry, duration, billable flag, body, author, and timestamp.

- [ ] **Step 2: Run the focused repository test**

Run: `pnpm --filter @egit/technician-mobile test -- src/data/offline-technician-repository.test.ts`

Expected: PASS because the JSON cache is already structurally capable; if it
fails, apply the smallest cache fix and rerun until PASS.

### Task 5: Full Verification and Documentation

**Files:**
- Modify: `apps/technician-mobile/README.md`
- Modify: `docs/superpowers/plans/2026-08-04-technician-complete-job-activity.md`

**Interfaces:**
- Consumes: all completed tasks.
- Produces: verified repository state and documented activity behavior.

- [ ] **Step 1: Document job activity behavior**

Add a concise README section explaining that job detail loads live Helpdesk
description/activity through Command Centre, caches the enriched response for
offline use, and never places MSP credentials on the device.

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm vitest run src/server/msp-central/client.test.ts src/server/mobile-api/service.test.ts
pnpm --filter @egit/technician-mobile test -- src/features/jobs/job-detail.test.tsx src/data/offline-technician-repository.test.ts src/features/worklogs/worklog-flow.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm --filter @egit/technician-mobile exec expo-doctor
```

Expected: all commands exit successfully. Record any pre-existing unrelated
warning separately rather than changing locked web design or build artifacts.

- [ ] **Step 4: Review the diff for scope and secrets**

Confirm the diff contains no credentials, no direct mobile-to-MSP calls, no
Command Centre web UI changes, and no accidental changes to existing local
notification work or generated build artifacts.

- [ ] **Step 5: Mark plan tasks complete**

Change each completed checkbox in this plan from `[ ]` to `[x]` only after its
verification command has passed.

## Execution record

Implemented and verified on 4 August 2026.

- Root tests: 110 files, 651 tests passed.
- Native tests: 29 files, 149 tests passed.
- Root lint: zero errors; one generated `.expo/types/router.d.ts` warning.
- Native TypeScript: passed.
- Next.js production build: passed.
- Expo Doctor: 18 of 20 checks passed. Existing environment findings remain
  for CocoaPods visibility and Expo SDK 57 patch-version drift; neither was
  introduced or expanded by this feature.
- Scope review: no Command Centre web UI files changed and no runtime secrets
  were added.

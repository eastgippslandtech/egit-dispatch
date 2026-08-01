# Command Centre Wallboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an authenticated, live-updating wallboard with a full-width Command Centre calendar and automatically derived technician presence, plus persisted Lunch/Leave controls shared by Dispatch and the native API.

**Architecture:** A pure server-side presence engine derives one safe status per technician from appointments, travel buffers, Outlook classification, Zoho People leave, and active manual overrides. Supabase stores only audited Lunch/Leave overrides. The wallboard consumes an authenticated no-store snapshot API and reuses the existing Day/Week calendar renderer in read-only mode.

**Tech Stack:** Next.js App Router, React 19, TypeScript, PostgreSQL/Supabase, Microsoft Graph, Zoho People API v3, Vitest, Testing Library, Playwright, Vercel.

## Global Constraints

- Keep `/dispatch` layout and scheduling behaviour intact.
- Add `/wallboard`; do not create a public kiosk route.
- Presence precedence is Leave, Lunch, Driving, On site, Personal, Meeting, In office.
- Never expose private Outlook event content.
- Store only Lunch/Leave overrides; derive all other presence live.
- Use Australia/Melbourne for status dates and times.
- Refresh the wallboard every 30 seconds while visible.
- Use separate Zoho People service credentials with `ZOHOPEOPLE.leave.READ`.

---

### Task 1: Outlook Classification And Presence Engine

**Files:**
- Modify: `src/server/dispatch/types.ts`
- Modify: `src/server/graph/types.ts`
- Modify: `src/server/graph/mappers.ts`
- Modify: `src/server/graph/mappers.test.ts`
- Create: `src/server/presence/types.ts`
- Create: `src/server/presence/derive.ts`
- Create: `src/server/presence/derive.test.ts`

**Interfaces:**
- Consumes: `Technician`, `Appointment`, `DispatchRequest`
- Produces: `deriveTechnicianPresence(input): TechnicianPresence[]`
- Produces: safe `outlookSensitivity` and `outlookCategories` appointment metadata

- [ ] Write failing Graph mapper tests proving Personal/category classification is redacted while normal meetings retain a safe subject.
- [ ] Run `pnpm test src/server/graph/mappers.test.ts` and verify the new assertions fail because classification metadata is absent.
- [ ] Add Graph categories and appointment Outlook classification fields; redact private, personal, and confidential content.
- [ ] Run the Graph mapper tests and verify they pass.
- [ ] Write failing presence tests for each status, complete precedence, 30-minute Lunch expiry, travel windows, Remote/In-house defaults, free-event exclusion, Meeting, Personal privacy, Leave fallback, and conflicts.
- [ ] Run `pnpm test src/server/presence/derive.test.ts` and verify failure because the presence engine does not exist.
- [ ] Implement the pure presence engine using Melbourne date/minute helpers and existing travel values.
- [ ] Run both test files and verify they pass.

### Task 2: Presence Persistence And Zoho People Boundary

**Files:**
- Create: `supabase/migrations/*_technician_presence_overrides.sql`
- Modify: `src/server/staff/profiles.ts`
- Modify: `src/server/dispatch/database.ts`
- Create: `src/server/presence/repository.ts`
- Create: `src/server/presence/repository.test.ts`
- Create: `src/server/presence/zoho-people.ts`
- Create: `src/server/presence/zoho-people.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `PresenceOverrideRepository`
- Produces: `createPostgresPresenceOverrideRepository({ databaseUrl, sql? })`
- Produces: `readZohoPeopleConfig(env)` and `createZohoPeopleClient(config)`

- [ ] Use `pnpm supabase migration new technician_presence_overrides` to create the migration.
- [ ] Define `staff_profiles.zoho_people_employee_id`, the constrained override status/source enums, the audited override table, indexes, RLS, and service-role-only grants.
- [ ] Write failing repository tests for input validation, active-row mapping, Lunch expiry, Leave end validation, and clear semantics.
- [ ] Run the repository tests and verify expected failures.
- [ ] Implement the lazy PostgreSQL repository and profile identity mapping.
- [ ] Run repository tests and verify they pass.
- [ ] Write failing Zoho People tests for token refresh, approved leave mapping, employee-ID matching, partial-day times, and safe failure when unconfigured.
- [ ] Implement the v3 leave client against `/people/api/v3/leave-tracker/leaves` with scope-ready separate service configuration.
- [ ] Update `.env.example` with `ZOHO_PEOPLE_API_BASE_URL`, `ZOHO_PEOPLE_ACCOUNTS_URL`, `ZOHO_PEOPLE_CLIENT_ID`, `ZOHO_PEOPLE_CLIENT_SECRET`, and `ZOHO_PEOPLE_REFRESH_TOKEN`.
- [ ] Run repository and Zoho People tests and verify they pass.

### Task 3: Snapshot Service And Authenticated APIs

**Files:**
- Create: `src/server/presence/service.ts`
- Create: `src/server/presence/service.test.ts`
- Create: `src/app/api/internal/presence/route.ts`
- Create: `src/app/api/internal/presence/route.test.ts`
- Create: `src/app/api/mobile/v1/presence/route.ts`
- Create: `src/app/api/mobile/v1/presence/route.test.ts`

**Interfaces:**
- Produces: `getWallboardSnapshot(dependencies?): Promise<WallboardSnapshot>`
- Web API: `GET`, `POST { action, technicianId, reason?, endsAt? }`
- Mobile API: `GET`, `POST { action, reason?, endsAt? }`

- [ ] Write failing service tests proving dashboard/override/leave composition, Zoho People fallback, private redaction, and source warnings.
- [ ] Implement snapshot composition with independent People failure handling.
- [ ] Write failing web route tests for authentication, snapshot reads, 30-minute Lunch, Leave validation, and clearing.
- [ ] Implement the no-store internal presence API.
- [ ] Write failing mobile route tests proving bearer authentication and self-only technician resolution.
- [ ] Implement the mobile presence route using the same repository and service.
- [ ] Run all presence service/API tests and verify they pass.

### Task 4: Read-Only Wallboard UI

**Files:**
- Modify: `src/app/dispatch/command-centre/prototype.tsx`
- Create: `src/app/wallboard/page.tsx`
- Create: `src/app/wallboard/protected-screen.tsx`
- Create: `src/app/wallboard/wallboard-screen.tsx`
- Create: `src/app/wallboard/page.test.tsx`
- Create: `src/app/wallboard/wallboard-screen.test.tsx`

**Interfaces:**
- Produces: `ReadOnlyDispatchCalendar`
- Consumes: `WallboardSnapshot`

- [ ] Write failing page tests for Zoho auth redirect, allowlist blocking, and approved wallboard rendering.
- [ ] Write failing client tests for four status panels, safe Personal copy, absence of queue/drawer, Day/Week switching, delayed-update state, and 30-second polling.
- [ ] Export a read-only calendar wrapper around the existing timeline/week renderer with pointer and drag interactions disabled.
- [ ] Implement the fixed-viewport wallboard header, Team Status strip, full-width calendar, live countdown, visibility-aware polling, and stale-data behaviour.
- [ ] Run wallboard tests and verify they pass.

### Task 5: Dispatch Presence Controls

**Files:**
- Create: `src/app/components/presence-controls.tsx`
- Create: `src/app/components/presence-controls.test.tsx`
- Modify: `src/app/dispatch/command-centre/prototype.tsx`
- Modify: `src/app/dispatch/command-centre/page.test.tsx`

**Interfaces:**
- Consumes: `/api/internal/presence`
- Produces: Team Status control with Start Lunch, End Lunch, Set Leave, and Clear Leave

- [ ] Write failing component tests for opening Team Status, starting Lunch, setting validated Leave, and clearing an active override.
- [ ] Implement the compact header control and accessible popover/dialog.
- [ ] Mount it in the existing Dispatch header without changing the three-panel layout.
- [ ] Run component and Dispatch page tests and verify they pass.

### Task 6: Database, Full Verification, And Production

**Files:**
- Modify only files required by verification findings.

**Interfaces:**
- Produces: deployed `/wallboard` and shared presence APIs

- [ ] Run `pnpm test`.
- [ ] Run `pnpm lint`.
- [ ] Run `pnpm build`.
- [ ] Start the local app with authentication disabled and verify `/wallboard` and `/dispatch` in a 1920x1080 browser.
- [ ] Confirm no page scroll, four status panels, full-width calendar, current-time shading, priority colours, travel buffers, status actions, and no browser error overlay.
- [ ] Check the linked Supabase migration state, dry-run the database push, apply the migration, and query the new table/column.
- [ ] Commit the implementation and push it to `main`.
- [ ] Deploy to Vercel production.
- [ ] Verify `command.egit.com.au/wallboard` reaches the authenticated wallboard flow and scan production logs for errors.

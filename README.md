# Command Centre

Internal EGIT dispatch portal for managing helpdesk requests and technician scheduling.

Command Centre currently runs with mock helpdesk data by default and supports Outlook calendar read-only mode. MSP Central Helpdesk live API access is not enabled yet; the repository includes an inactive MSP Central skeleton, fixture mappers, readiness checks, and tests so live access can be enabled deliberately once credentials and endpoint samples are confirmed.

## Run Locally

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000/dispatch](http://localhost:3000/dispatch) or [http://localhost:3000/mobile](http://localhost:3000/mobile). Local Zoho OAuth callback URL: `http://localhost:3000/api/auth/callback/zoho`.

Useful commands:

```bash
pnpm test
pnpm lint
pnpm build
```

## Routes

- `/dispatch` - main Command Centre screen.
- `/dispatch/command-centre` - same Command Centre prototype route kept for continuity.
- `/mobile` - mobile technician MVP for schedule, job detail, timer, notes, read-only Outlook events, and API-ready field-work scaffolds.

## Environment

Copy `.env.example` to `.env.local` for local configuration. Phase 1 runs with mock data and does not require real integration credentials.

Required/default local values:

```bash
MOCK_INTEGRATIONS=true
CALENDAR_DATA_SOURCE=mock
DISPATCH_DATA_SOURCE=mock
DEFAULT_TIMEZONE=Australia/Melbourne
GRAPH_CALENDAR_TIMEZONE=Australia/Melbourne
APP_BASE_URL=https://command.egit.com.au
NEXT_PUBLIC_APP_NAME=Command Centre
```

Command Centre user login uses Auth.js / NextAuth with the built-in Zoho provider. Do not add a username/password login, store Zoho passwords, or enable public signup.

Production callback URL:

```bash
https://command.egit.com.au/api/auth/callback/zoho
```

Auth values:

```bash
DISABLE_AUTH=false
AUTH_SECRET=
AUTH_URL=https://command.egit.com.au
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_ACCOUNTS_URL=https://accounts.zoho.com.au
ALLOWED_AUTH_EMAILS=simeon@egit.com.au,mattd@egit.com.au,jervy@egit.com.au,riley@egit.com.au
```

For local real-auth testing, set:

```bash
AUTH_SECRET=<generated-long-random-secret>
AUTH_URL=http://localhost:3000
ZOHO_CLIENT_ID=<local Zoho OAuth client id>
ZOHO_CLIENT_SECRET=<local Zoho OAuth client secret>
ALLOWED_AUTH_EMAILS=simeon@egit.com.au,mattd@egit.com.au,jervy@egit.com.au,riley@egit.com.au
```

`AUTH_SECRET` may also be provided as `NEXTAUTH_SECRET` for compatibility. With `AUTH_SECRET`, `AUTH_URL`, Zoho client credentials, and an allowlisted account configured, `/dispatch` and `/mobile` run locally with normal Zoho sign-in and do not need `DISABLE_AUTH=1`.

`DISABLE_AUTH=true` or `DISABLE_AUTH=1` is allowed only for local development, automated UI smoke tests, and preview-only build review when OAuth is not available. Production must not set `DISABLE_AUTH`; the server ignores it when `NODE_ENV=production` or `VERCEL_ENV=production`. When enabled outside production, `/dispatch` and `/mobile` load with a mock approved session and `/auth/sign-in` redirects back to `/dispatch`.

Auth.js also supports provider inference via `AUTH_ZOHO_ID` and `AUTH_ZOHO_SECRET`; the app explicitly supports `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET` for clarity.

Zoho OAuth uses fixed callback URLs only. Test live OAuth on `https://command.egit.com.au`; Vercel preview deployments are for UI/build review and do not need their own Zoho callbacks. If a fixed staging domain is added later, use `https://command-preview.egit.com.au/api/auth/callback/zoho`.

Zoho OAuth access is for approved EGIT work accounts only. Do not add `eastgippsland.tech` addresses for Command Centre access unless they are specifically approved later.

### Wallboard login

`/wallboard` also supports one dedicated local account for the wallboard PC. It
can view the wallboard and live presence feed only; it cannot open Dispatch or
use write/admin endpoints. The session lasts up to 30 days.

Generate the password hash:

```bash
pnpm wallboard:hash -- "your wallboard password"
```

Set these protected server-side values in Vercel:

```bash
WALLBOARD_LOCAL_USERNAME=wallboard
WALLBOARD_LOCAL_PASSWORD_HASH=<generated scrypt hash>
```

Do not reuse an EGIT staff password or store the plain-text password in the
repository.

Future server-side service values:

```bash
DATABASE_URL=
MSP_CENTRAL_BASE_URL=
MSP_CENTRAL_PORTAL=
MSP_CENTRAL_CLIENT_ID=
MSP_CENTRAL_CLIENT_SECRET=
MSP_CENTRAL_REFRESH_TOKEN=
MSP_CENTRAL_REQUEST_WEB_BASE_URL=
MICROSOFT_TENANT_ID=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
```

Keep Command Centre user-login OAuth separate from MSP Central API service OAuth. Do not use personal login session tokens for MSP Central API reads or updates unless explicitly approved later. Do not expose Supabase service-role keys or integration secrets to browser code. Only `NEXT_PUBLIC_` variables are sent client-side.

Dispatch data source modes:

```bash
DISPATCH_DATA_SOURCE=mock
DISPATCH_DATA_SOURCE=msp-central-fixture
DISPATCH_DATA_SOURCE=msp-central
```

Default is `mock`. `msp-central-fixture` loads synthetic fixture JSON from `src/server/msp-central/__fixtures__/` and exercises the MSP Central mappers without live API calls. `msp-central` is reserved for future live API access and currently fails closed unless deliberately implemented.

## Staff Identity Mapping

Command Centre staff profiles use `zoho_email` as the primary staff identity key. For most EGIT staff, `zoho_email`, `outlook_email`, and `msp_central_email` are the same, but the profile keeps separate fields for exceptions:

- `zoho_email`
- `outlook_email`
- `outlook_user_principal_name`
- `msp_central_email`
- `msp_central_technician_id`
- `msp_central_technician_name`
- `dispatch_enabled`
- `calendar_enabled`

Current staff examples use `simeon@egit.com.au`, `mattd@egit.com.au`, `jervy@egit.com.au`, and `riley@egit.com.au`. Matt's account is intentionally `mattd@egit.com.au`.

MSP Central technician matching should use `msp_central_technician_id` first, then `msp_central_email`, then `zoho_email` only when `msp_central_email` is blank. Display-name matching is a manual-review warning path only.

Keep tokens separate: Zoho user login tokens are only for Command Centre sessions, Microsoft Graph application tokens are only for server-side Outlook access, and future MSP Central API tokens are only for server-side Helpdesk API access.

## Outlook Calendar Read-Only

Phase 2 can read technician Outlook calendars server-side through Microsoft Graph application permissions. Default mode remains mock:

```bash
CALENDAR_DATA_SOURCE=mock
```

To test Outlook reads, configure:

```bash
CALENDAR_DATA_SOURCE=outlook
MICROSOFT_TENANT_ID=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
GRAPH_CALENDAR_TIMEZONE=Australia/Melbourne
```

Use Microsoft Graph application permissions with admin consent. Start with `Calendars.ReadBasic`; use `Calendars.Read` only if subject/location/body preview details are needed. Do not grant `Calendars.ReadWrite` for this phase. The protected health endpoint is `/api/internal/graph/health`.

Alias endpoint: `/api/internal/outlook/health`.

## Dispatch Calendar Rules

Business hours are Monday-Friday, 9:00 AM-5:30 PM, using `Australia/Melbourne`.

- Day View uses a single shared timeline scale for grid markers, appointments, travel side buffers, current-time indicator, drag previews, and drop-to-time conversion.
- Week View is Monday-Friday focused; Saturday/Sunday remain selectable by date picker for review.
- Weekend bookings are closed-day/out-of-hours issues and should require a strong warning before any future scheduling writeback.
- Command Centre is laid out as a viewport-height app shell: compact header, compact Dispatch Health, internally scrolling queue/drawer, and the calendar as the hero surface.

Travel buffer rules for V1:

- Travel is estimated from technician base office to site and back to base office.
- Bairnsdale office: `137 Main Street, Bairnsdale VIC 3875`.
- Sale office: `387 Raymond Street, Sale VIC 3850`.
- Travel times round up to the nearest 5 minutes.
- Remote jobs have 0 travel.
- Travel buffers render as same-height ghost side extensions attached to the job card, not separate rows.

## MSP Central API Readiness

MSP Central live API calls and writeback are not implemented yet. Do not create temporary/manual dispatch records, local placeholder jobs, or Supabase request rows to work around API access. The current readiness layer includes:

- `src/server/msp-central/client.ts` - typed future client interface with fixture and fail-closed live implementations.
- `src/server/msp-central/types.ts` - raw MSP Central response contracts.
- `src/server/msp-central/mappers.ts` - mapper from MSP Central-like JSON into Command Centre `DispatchRequest` models.
- `src/server/msp-central/fixtures.ts` and `src/server/msp-central/__fixtures__/` - synthetic sample payloads for mapper tests.
- `src/server/msp-central/health.ts` - safe readiness status.
- `src/server/msp-central/url.ts` - future “Open in Helpdesk” URL builder.
- `/api/internal/msp-central/readiness` - protected readiness endpoint that returns env presence booleans, fixture status, mapper status, and next-step guidance without exposing secrets.
- `/api/internal/identity/health` - protected staff identity readiness endpoint.

Sample-response drop-in workflow:

1. Save a sanitised MSP Central request list response as `src/server/msp-central/__fixtures__/request-list.real-sample.json`.
2. Save a sanitised request detail response as `src/server/msp-central/__fixtures__/request-detail.real-sample.json`.
3. Run the MSP Central mapper tests.
4. Adjust `src/server/msp-central/mappers.ts` until the Command Centre models are correct.
5. Only then consider enabling `DISPATCH_DATA_SOURCE=msp-central`.

Do not commit sensitive customer data. Prefer sanitised fixtures.

Waiting on MSP Central:

- OAuth/API credentials.
- Base API domain.
- Portal name/key.
- Request list endpoint confirmed.
- Request detail endpoint confirmed.
- Technician fields confirmed.
- Scheduled start/end fields confirmed.
- Note endpoint confirmed.
- Update/writeback permissions confirmed later.

## Supabase

The local project is linked to the Supabase project `Command Centre`.

```bash
pnpm supabase projects list
```

Initial schema migration:

```bash
supabase/migrations/20260707231700_dispatch_core.sql
```

The migration creates:

- `technicians`
- `dispatch_links`
- `dispatch_sync_logs`
- `dispatch_settings`

RLS is enabled on all tables. Phase 1 grants access only to `service_role`; the UI still reads mock data from the app bundle.

Apply migrations when ready:

```bash
pnpm supabase db push
```

## Vercel

The local project is linked to `east-gippsland-it/egit-dispatch`.

Pull project settings:

```bash
pnpm vercel pull --yes --environment=development --scope east-gippsland-it
```

Create a preview deployment:

```bash
pnpm vercel --scope east-gippsland-it
```

Production deployment:

```bash
pnpm vercel --prod --scope east-gippsland-it
```

Production domain target: `command.egit.com.au`.

## Yeastar Call Reporting

Command Centre can ingest completed external calls from a Yeastar P-Series
Software Edition PBX without changing the existing Yeastar recording
integration.

The implementation:

- Verifies signed completed-call (`30012`) webhooks.
- Reconciles recent CDRs every five minutes.
- Uses CDR v2 per-leg connected talk time and excludes internal/unanswered
  calls, ringing, and separately reported hold time.
- Retrieves Yeastar AI transcripts and summaries only. It never downloads or
  stores call audio.
- Matches external numbers to Zoho CRM Contacts first, then Accounts, using a
  separate service OAuth client.
- Adds read-only call activities to Dispatch and weekly external talk time to
  Wallboard staff cards.
- Keeps transcripts behind approved staff authentication; the local wallboard
  account receives totals only.

Required server variables:

```text
YEASTAR_BASE_URL=https://eastgippslandit.ras.yeastar.com
YEASTAR_CLIENT_ID=
YEASTAR_CLIENT_SECRET=
YEASTAR_WEBHOOK_SECRET=
YEASTAR_API_USER_AGENT=EGIT-Command-Centre/1.0
ZOHO_CRM_ACCOUNTS_URL=https://accounts.zoho.com.au
ZOHO_CRM_CLIENT_ID=
ZOHO_CRM_CLIENT_SECRET=
ZOHO_CRM_REFRESH_TOKEN=
ZOHO_CRM_API_DOMAIN=https://www.zohoapis.com.au
```

Configure the PBX webhook as:

```text
POST https://command.egit.com.au/api/integrations/yeastar/webhook
```

The production schedules are declared in `vercel.json`. Vercel calls the
processor every minute and reconciliation every five minutes, authorizing both
with the existing `CRON_SECRET`.

## Current Scope

Included:

- Next.js App Router app.
- Zoho OAuth sign-in architecture using Auth.js / NextAuth.
- `ALLOWED_AUTH_EMAILS` access gate for approved EGIT staff.
- Dark Command Centre UI.
- Compact Dispatch Health section with working filters and de-select behaviour.
- Left unscheduled request queue.
- Horizontal technician timeline from 9:00 AM to 5:30 PM.
- Right request detail drawer.
- Mock technician/request/appointment/sync data.
- Dispatch Health calculation function and tests.
- Search/filter controls for top search, queue search, technician, status, priority, SLA risk, Dispatch Health, and Clear filters.
- Drag/drop mock-mode scheduling with confirmation.
- Office-based travel buffer modelling.
- Outlook read-only calendar integration path.
- MSP Central fixture/readiness skeleton.
- Supabase/Postgres migration file.
- Vercel-ready build.

Mock-only:

- Helpdesk request data.
- Scheduling/writeback.
- Sync/SLA warning states.

Read-only:

- Outlook calendar events when `CALENDAR_DATA_SOURCE=outlook`.

Disabled until configured:

- Update Helpdesk.
- Create/update Outlook calendar event.
- Live MSP Central request reads.
- Live MSP Central writeback.

## Future Stages

Recommended next steps once API access is available:

- Replace synthetic fixture JSON with sanitised real MSP Central sample responses.
- Confirm MSP Central request list/detail/technician field names.
- Implement server-side MSP Central read client.
- Map real helpdesk requests into the existing typed dispatch model.
- Store `dispatch_links` and sync logs in Supabase.
- Keep Outlook writeback disabled until explicitly approved.
- Add MSP Central update/writeback only after read mapping is verified.

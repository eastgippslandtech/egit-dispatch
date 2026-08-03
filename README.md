# Command Centre

Command Centre is EGIT's internal dispatch and technician operations app. It combines MSP Central requests, Outlook schedules, durable background writeback, integration health, the technician mobile experience, and the wallboard.

## Local setup

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm dev
```

Open `http://localhost:3000/dispatch`. The fixed local Zoho callback is `http://localhost:3000/api/auth/callback/zoho`.

Use mock sources for isolated UI work:

```text
MOCK_INTEGRATIONS=true
CALENDAR_DATA_SOURCE=mock
DISPATCH_DATA_SOURCE=mock
```

Use live sources only with server-side service credentials and a migrated database:

```text
MOCK_INTEGRATIONS=false
CALENDAR_DATA_SOURCE=outlook
DISPATCH_DATA_SOURCE=msp-central
DATABASE_URL=
INTEGRATION_CRON_SECRET=
```

Never expose provider credentials, database URLs, cron secrets, or Supabase service-role credentials through `NEXT_PUBLIC_` variables.

## Production

- App: `https://command.egit.com.au`
- Dispatch: `https://command.egit.com.au/dispatch`
- Integration health and recovery: `https://command.egit.com.au/integrations`
- Zoho sign-in callback: `https://command.egit.com.au/api/auth/callback/zoho`
- Recovery worker: `POST https://command.egit.com.au/api/internal/integrations/process`
- Scheduler setup: `POST https://command.egit.com.au/api/internal/integrations/scheduler`

Vercel preview deployments are for UI and build review only. Do not add changing preview URLs to Zoho OAuth or make preview OAuth a release dependency.

## Verification

```powershell
pnpm test
pnpm lint
pnpm build
```

Automated tests use fakes and fixtures. They do not write to MSP Central, Outlook, or the production database.

## Operations

Apply Supabase migrations in timestamp order before enabling the worker. Configure `DATABASE_URL` and `INTEGRATION_CRON_SECRET` in the production server environment, then install and verify the one-minute recovery schedule.

The complete setup, health, retry, token-rotation, emergency-disable, and controlled provider verification procedure is in [Integration Recovery Runbook](docs/integration-recovery-runbook.md).

## Authentication

Staff use Zoho OAuth and must be present in `ALLOWED_AUTH_EMAILS`. The login token is for the Command Centre session only. MSP Central, Microsoft Graph, Zoho People, CRM, Yeastar, push, and email integrations use separate server-side service credentials.

Production OAuth uses only:

```text
https://command.egit.com.au/api/auth/callback/zoho
```

The wallboard has a separate restricted local account configured with `WALLBOARD_LOCAL_USERNAME` and a generated scrypt `WALLBOARD_LOCAL_PASSWORD_HASH`. Never store its plain-text password.

## Database and deployment

The repository is linked to the Command Centre Supabase and Vercel projects. Operators should inspect pending migrations before applying them and complete the runbook checks before production rollout.

```powershell
pnpm supabase migration list --linked
pnpm supabase db push --dry-run
pnpm supabase db push
pnpm vercel --prod --scope east-gippsland-it
```

Deployment is not proof that provider writeback works. Complete the controlled provider checklist and inspect `/integrations` before enabling the feature for staff.

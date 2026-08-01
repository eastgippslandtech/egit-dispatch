# Yeastar Call Transcripts and External Talk-Time Design

**Date:** 2026-07-30
**Status:** Approved
**Target:** Existing Command Centre deployment on Vercel with Supabase Postgres

## Objective

Add completed external Yeastar calls to Command Centre as historical technician
activities, ingest Yeastar AI transcripts and summaries, match callers to Zoho
CRM, and display each technician's current-week external talk time on the
wallboard.

The existing Yeastar-to-Zoho CRM recording integration remains unchanged.
Command Centre will not upload, copy, download, or permanently retain call
recordings. External transcription providers are out of scope; Yeastar AI
transcripts are the only transcript source.

## Confirmed Environment

- Yeastar P-Series Software Edition.
- Firmware `83.24.0.30-beta1`.
- PBX FQDN: `https://eastgippslandit.ras.yeastar.com`.
- Yeastar AI Call Transcription is enabled and licensed.
- Command Centre is deployed on Vercel and uses Supabase Postgres.
- Command Centre timezone is `Australia/Melbourne`.
- A new Yeastar API application and a separate Zoho CRM service OAuth client
  will be configured during activation.

Official Yeastar Software Edition documentation confirms this firmware family
supports:

- CDR v2 list and detail APIs.
- Per-leg/timeline `talk_duration` data.
- Completed-call event `30012`.
- Signed webhooks using `X-Signature` and HMAC-SHA256.
- `cdr/getaicontext`, `cdr/getaisummary`, and `cdr/aidownload`.

The implementation must still capability-test these interfaces against the
connected PBX before enabling production ingestion.

## Architecture

Use signed Yeastar webhooks for low-latency discovery and Supabase cron for
durable processing and reconciliation.

1. Yeastar sends completed-call event `30012` to
   `/api/integrations/yeastar/webhook`.
2. The route reads the raw body, verifies `X-Signature` with the configured
   webhook secret, stores the event idempotently, queues the CDR, and returns
   quickly.
3. Supabase cron calls `/api/internal/yeastar/process` every minute.
4. Processing retrieves CDR v2 detail, identifies external answered legs,
   maps connected segments to staff, and stores call/segment data.
5. Processing retrieves Yeastar AI transcript and summary data when available.
6. A separate server-side Zoho CRM service token searches Contacts first and
   Accounts second by normalized phone number.
7. Supabase cron calls `/api/internal/yeastar/reconcile` every five minutes to
   discover calls missed by webhooks.
8. Dispatch and wallboard read local Supabase projections only. They never call
   Yeastar or Zoho while rendering.

Persistent WebSocket subscriptions are not used because Vercel does not provide
the always-on process required for heartbeat maintenance.

## Call Eligibility

Only answered or connected external calls are stored as reportable activities.

Include:

- Answered inbound trunk calls.
- Connected outbound trunk calls.
- External call segments handled after queue or ring-group routing.
- Each technician segment involved in a transferred external call.

Exclude:

- Internal extension-to-extension calls.
- Unanswered, missed, abandoned, or voicemail calls.
- Paging, intercom, or system-generated calls.
- Ringing and queue waiting time.
- Hold time when Yeastar exposes it separately.

Eligibility is determined from CDR v2 call type, trunk involvement, status,
timeline events, extension participation, and `talk_duration`. Ambiguous calls
are marked for review and do not contribute to totals until resolved.

## Talk-Time Attribution

`connected_talk_seconds` and segment `external_talk_seconds` use Yeastar's
actual connected talk duration, never total call duration.

- Every segment has a Yeastar segment ID or deterministic key.
- A unique constraint prevents duplicate segment attribution.
- Transferred calls credit each technician only for that technician's connected
  segment.
- When the PBX supplies only a final technician and aggregate connected time,
  the available time is credited once to that technician and the call records
  that segment-level attribution was unavailable.
- Weekly totals include valid external segments from Monday 12:00 am through
  the current time in `Australia/Melbourne`.

## Database Model

### `yeastar_calls`

- `id uuid primary key`
- `yeastar_call_id text`
- `yeastar_cdr_id text`
- `parent_call_id text nullable`
- `direction text`
- `external_number text`
- `normalised_external_number text`
- `started_at timestamptz`
- `answered_at timestamptz nullable`
- `ended_at timestamptz`
- `connected_talk_seconds integer`
- `call_status text`
- `transcript_status text`
- `transcript text nullable`
- `summary text nullable`
- `action_items jsonb`
- `zoho_contact_id text nullable`
- `zoho_account_id text nullable`
- `zoho_call_id text nullable`
- `matched_customer_name text nullable`
- `matched_contact_name text nullable`
- `recording_reference text nullable`
- `segment_attribution_available boolean`
- `processing_attempts integer`
- `next_processing_at timestamptz nullable`
- `last_processing_error text nullable`
- `raw_metadata jsonb`
- `created_at timestamptz`
- `updated_at timestamptz`

Unique indexes cover Yeastar CDR ID and call ID where present. No recording URL
containing an access token may be persisted in `recording_reference` or
`raw_metadata`.

### `yeastar_call_segments`

- `id uuid primary key`
- `yeastar_call_id uuid references yeastar_calls`
- `yeastar_segment_id text`
- `command_centre_staff_id uuid references staff_profiles`
- `yeastar_extension text`
- `yeastar_user_id text nullable`
- `connected_at timestamptz`
- `disconnected_at timestamptz`
- `external_talk_seconds integer`
- `raw_metadata jsonb`
- `created_at timestamptz`
- `updated_at timestamptz`

A unique `(yeastar_call_id, yeastar_segment_id)` constraint prevents duplicate
talk time.

### `yeastar_staff_mappings`

- `id uuid primary key`
- `command_centre_staff_id uuid references staff_profiles`
- `yeastar_user_id text nullable`
- `yeastar_extension text`
- `active boolean`
- timestamps

Extension and user identifiers are configurable data, not controller constants.

### `phone_customer_mappings`

- normalized phone number
- Zoho Contact ID
- Zoho Account ID
- customer and contact display names
- CRM links
- manually confirmed flag
- timestamps

Manual mappings take precedence over future automatic searches.

### Operational Tables

- `yeastar_ingestion_events` stores replay-safe webhook envelopes.
- `yeastar_sync_state` stores reconciliation cursor and health timestamps.
- `yeastar_job_runs` stores processing attempts, outcome, safe error details,
  and scheduling data.

All tables use RLS, revoke access from `anon` and `authenticated`, and grant
server-side access through the service database role only.

## Yeastar Client

The server-side client:

- Uses the required `User-Agent` header.
- Stores Client ID and Client Secret only in server environment variables.
- Coordinates Yeastar access/refresh tokens in Supabase to avoid parallel
  Vercel functions generating unnecessary tokens.
- Uses the v2 CDR detail timeline to derive call segments.
- Capability-tests transcript endpoints before reporting them as available.
- Retries temporary HTTP/network failures with bounded backoff.
- Does not repeatedly retry invalid calls or permanently unavailable
  transcripts.

Transcript states are:

- `pending`
- `metadata_received`
- `awaiting_transcript`
- `complete`
- `failed`
- `ignored_internal`
- `ignored_unanswered`

Calls awaiting Yeastar AI output retry for no more than 24 hours. They then move
to `failed` and remain manually retryable by an administrator. Calls remain
usable for timeline and talk-time reporting if transcript retrieval fails.

## Zoho CRM Matching

Zoho CRM uses a separate service OAuth client and refresh token. It is never
combined with Command Centre user login or MSP Central credentials.

1. Normalize the external number to E.164.
2. Check a manually confirmed local mapping.
3. Search Zoho CRM Contacts using the module phone search.
4. If no Contact matches, search Accounts.
5. Store matched IDs, display names, and safe CRM record links locally.
6. Allow an administrator to save or replace the mapping on the call detail
   screen.

Australian normalization accepts local mobile, local landline, `61`-prefixed,
and `+61`-prefixed forms. Invalid or ambiguous numbers remain unmatched.

Command Centre does not create CRM Call activities and does not upload
recordings because the existing standard Yeastar integration already owns that
behavior.

## Command Centre UI

### Timeline

Completed calls render as a distinct phone activity type in Day and Week views.
They use actual timestamps, are visually secondary to scheduled work, and are
not draggable or treated as future appointments.

Cards show:

- Start/end.
- External talk time.
- Inbound/outbound direction.
- Customer or normalized phone number.
- Transcript state.

### Call History and Detail

`/calls` lists external calls with search and technician, date, direction,
customer, and transcript-status filters.

`/calls/[callId]` shows technician, customer/contact, phone, direction,
timestamps, external talk time, summary, action items, transcript, CRM links,
processing state, and admin retry/manual matching actions.

Transcript content is escaped by React and never rendered as trusted HTML.

### Wallboard

Each existing staff card adds one compact metric:

`External Talk Time This Week · 3h 42m`

Formatting:

- Zero: `0m`
- Under one hour: `42m`
- One hour or more: `3h 42m`

Staff users can open the technician's current-week call history. The local
wallboard account sees totals and activity labels but cannot open transcripts.

### Admin Settings

Admin-only settings provide:

- Yeastar connection test and detected capabilities.
- Last webhook and reconciliation health.
- Manual synchronization.
- Failed transcript jobs and retry.
- Technician extension/user mappings.
- Zoho CRM connection health and matching toggle.
- Unmatched number review and manual customer mapping.

Simeon's `admin` staff role is the initial authorization source. Technician
roles cannot change integration settings.

## Scheduling and Caching

- Processing runs every minute through Supabase `pg_cron` and `pg_net`.
- Reconciliation runs every five minutes with a small cursor overlap.
- Unique constraints make webhook and reconciliation ingestion idempotent.
- The wallboard weekly total query aggregates indexed local segment rows.
- Wallboard data refresh remains on its existing 30-second interval.
- No Yeastar or Zoho request is made during wallboard rendering.

## Logging and Failure Handling

Structured operational data records:

- Calls discovered, inserted, updated, and ignored.
- Duplicate events and segments prevented.
- Transcripts completed or failed.
- CRM matches and unmatched numbers.
- Last successful webhook, processing run, and reconciliation.

Browser responses expose safe errors only. Tokens, secrets, signed recording
URLs, and unrestricted raw responses are excluded.

## Retention

Transcript and metadata retention defaults to 365 days and is stored as an
admin-configurable setting. A scheduled cleanup marks or removes expired
transcript content without affecting immutable talk-time segment totals needed
for reporting. No audio cleanup is needed because Command Centre never stores
audio.

## Test Strategy

Automated tests cover:

- Internal and unanswered calls are excluded.
- Ringing, waiting, and separate hold time are not counted.
- Connected external talk time is counted.
- Repeated CDR/webhook/segment events remain idempotent.
- Transferred call segments are divided correctly.
- Aggregate fallback credits only the final technician once.
- Australian phone normalization.
- Zoho Contact-first and Account-second matching.
- Monday-based Melbourne week boundaries.
- Calls outside the current week are excluded.
- Talk-time formatting.
- Transcript retry exhaustion and safe manual retry.
- No code path downloads or stores call recordings.
- Webhook signature and replay protection.
- Admin-only settings and transcript access.
- Wallboard account transcript isolation.
- Existing Yeastar-to-Zoho recording behavior remains untouched.

## Activation Requirements

Environment values will include:

- `YEASTAR_BASE_URL`
- `YEASTAR_CLIENT_ID`
- `YEASTAR_CLIENT_SECRET`
- `YEASTAR_WEBHOOK_SECRET`
- `YEASTAR_API_USER_AGENT`
- `ZOHO_CRM_ACCOUNTS_URL`
- `ZOHO_CRM_CLIENT_ID`
- `ZOHO_CRM_CLIENT_SECRET`
- `ZOHO_CRM_REFRESH_TOKEN`
- `ZOHO_CRM_API_DOMAIN`
- `INTEGRATION_CRON_SECRET`

Activation requires:

1. Create a Yeastar API application with CDR, recording metadata, AI
   transcription, user/extension, and event permissions.
2. Enable remote API access for the PBX FQDN.
3. Configure event `30012` as a signed POST webhook.
4. Create a separate Zoho CRM OAuth client with read-only Contacts, Accounts,
   Calls, and secure-search scopes.
5. Apply Supabase migrations and configure scheduled jobs.
6. Run capability and connection tests before enabling live ingestion.

## Explicit Non-Goals

- Replacing or modifying Yeastar's standard Zoho CRM integration.
- Uploading or permanently storing recordings.
- External speech-to-text providers.
- Creating duplicate Zoho CRM Call activities.
- Counting internal, missed, abandoned, ringing, queue-waiting, or
  system-generated call time.
- Running a permanent WebSocket worker on Vercel.

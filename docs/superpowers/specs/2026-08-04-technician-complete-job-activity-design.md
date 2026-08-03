# Technician Complete Job Activity Design

## Goal

Make each native technician request useful in the field by showing the current
Helpdesk request description and the complete chronological job conversation,
including customer replies, internal technician notes, and Work Logs.

## Existing problem

The native job-detail screen already renders `description` and
`previousNotes`, but the database-backed mobile endpoint builds both fields
from up to five `dispatch_sync_logs` rows. Those rows describe Command Centre
sync activity; they are not the authoritative Helpdesk conversation. As a
result, a technician can open a real scheduled request and see no useful notes
even though MSP Central contains the request description, replies, internal
notes, and historical Work Logs.

## Data source and security

The native app continues to call the existing authenticated Command Centre
mobile API. It must not connect directly to MSP Central and must not receive
Helpdesk credentials.

When `GET /api/mobile/v1/jobs/:jobId` resolves a database-backed job, the
server uses the job's stored `sdpRequestId` with the existing configured
`MspCentralClient.getRequestContext` method. The server merges the fresh
request context into the scheduled database job. Dispatch scheduling,
technician ownership, timers, and permissions remain authoritative from the
Command Centre database; request content and activity remain authoritative
from MSP Central.

The MSP Central request-context reader follows pagination for both notes and
Work Logs so the result is the complete available history rather than a
single 100-row page. The existing partial-failure behavior remains: failure to
load one stream does not discard the request or the other stream.

## Mobile contract

`MobileJobNote` becomes the shared activity-entry contract and gains:

- `kind`: `customer_reply`, `internal_note`, or `worklog`
- `durationMinutes`: a positive number for Work Logs when available, otherwise
  `null`
- `isBillable`: a boolean for Work Logs when available, otherwise `null`

Existing note fields remain unchanged. `previousNotes` remains the field name
to preserve repository, SQLite, offline mutation, and Work Log behavior.
Legacy cached entries without the new fields are rendered as an internal or
customer note based on visibility.

`MobileJob.activityWarning` carries a non-blocking warning when notes or Work
Logs could not be refreshed. It is `null` for a complete live response and for
legacy sources that have no separate Helpdesk activity stream.

Fresh activity entries are normalized as follows:

- customer response -> `customer_reply`, external visibility
- technician note -> `internal_note`, internal visibility
- Work Log -> `worklog`, external visibility when billable and internal
  visibility otherwise

Entries are sorted newest first using their creation time. Stable entry IDs
come from MSP Central. Missing timestamps use the request update time only as
a display-safe fallback and never change the content order of timestamped
entries.

The fresh Helpdesk request also replaces stale snapshot values for subject,
description, customer, site, contact, priority, status, and SLA where the
Helpdesk response supplies them. The scheduled start/end, selected technician,
Outlook link, travel context, timer behavior, permissions, and Command Centre
job ID are preserved.

## Native experience

The job-detail screen keeps the request summary and actions intact. The
request description is displayed in its own readable `Request description`
section rather than embedded in a compact metadata line.

`Latest ticket notes` becomes `Job activity`. Each entry displays:

- a clear `Customer reply`, `Internal note`, or `Work Log` label
- author
- local Melbourne date and time
- complete plain-text body
- Work Log duration and `Billable` or `Internal` status when available

The activity list is newest first. Empty Helpdesk activity displays a helpful
empty state rather than implying that sync logs are ticket notes.

Pull-to-refresh reloads the job through the repository. Cached content remains
visible while refreshing. A refresh failure leaves the cached content on
screen and displays a small non-blocking message.

## Offline behavior

The existing offline repository stores the entire enriched `MobileJob` JSON,
including all activity entries, in SQLite whenever a live read succeeds.
Opening the job offline returns that cached copy. A failed refresh does not
replace or delete a previously cached complete timeline.

No schema migration is needed because cached jobs are stored as serialized
JSON. Old cached payloads remain readable through the legacy-entry fallback.

## Compatibility boundaries

- Preserve live schedules and day filtering.
- Preserve Outlook-only bookings and their read-only behavior.
- Preserve timers and the global timer banner.
- Preserve Work Log creation, charged travel time, outcomes, and offline
  mutation queuing.
- Preserve push notifications, job completion, payments handoff, and lunch.
- Do not change the locked Command Centre web design.
- Do not expose MSP Central tokens, secrets, or credentials to the device.

## Failure handling

- A missing database job still returns the existing 404 behavior.
- An unconfigured MSP Central integration returns the existing database
  snapshot without failing the screen.
- A configured but temporarily unavailable request-context call returns the
  scheduled job with its safe database fallback and a non-blocking activity
  warning.
- Partial note or Work Log failures retain whichever Helpdesk streams loaded
  successfully and surface the corresponding warning.
- HTML from Helpdesk continues to be converted to plain text by the existing
  MSP Central mappers.

## Tests and verification

Automated coverage must prove:

- all paginated note and Work Log pages are loaded
- customer replies, internal notes, and Work Logs normalize correctly
- the activity stream is ordered newest first
- Work Log duration and billable state survive the mobile API contract
- fresh Helpdesk description and job fields replace stale sync-log snapshots
- scheduling, technician, permissions, and timer-related fields remain intact
- missing or failed Helpdesk context falls back safely
- the native screen shows the full description and labelled activity entries
- legacy cached entries remain renderable
- refresh keeps content visible and reports failure without blanking the job
- enriched job activity is available from SQLite when offline

Final verification runs the focused tests, the complete test suite, lint,
typecheck, and Expo diagnostics.

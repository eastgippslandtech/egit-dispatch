# Command Centre Wallboard Design

## Goal

Add a dedicated Command Centre wallboard that keeps the existing branded calendar
and scheduling presentation, removes dispatcher-only side panels, and makes each
technician's current operational status immediately visible on a large display.

The wallboard is a read-only view. The existing `/dispatch` screen remains the
dispatcher workspace and keeps its queue, drag-and-drop scheduling, request drawer,
health filters, and work-log controls.

## Route And Access

- Add the wallboard at `/wallboard`.
- Protect it with the existing Zoho sign-in and `ALLOWED_AUTH_EMAILS` access rules.
- Preserve the current Command Centre branding and dark theme.
- Default to Day view for the current Australia/Melbourne date.
- Keep Day/Week and date navigation available.
- Do not include request search, queue filters, scheduling controls, drag-and-drop,
  the unscheduled queue, or the request detail drawer.
- Do not expose a public or unauthenticated kiosk route in V1.

## Page Layout

The wallboard uses the existing compact desktop density and fills the available
viewport without normal page scrolling.

From top to bottom:

1. Compact Command Centre header with the logo, current date, timezone, Day/Week
   control, date navigation, live connection state, and last refresh time.
2. A prominent four-column Team Status strip, one equal panel per enabled
   technician.
3. A full-width read-only copy of the existing technician Day timeline or Week
   planner.

The calendar is the largest element. There are no left or right sidebars.

Each Team Status panel shows:

- Technician name and base office.
- Current state with a distinct icon and colour.
- Safe current activity context when available.
- The current appointment or override end time.
- A live remaining-time label when the state has an end time.
- A small conflict indicator when overlapping sources disagree.

Private Outlook event subjects, bodies, attendees, and locations must never appear
in Team Status. A private event is displayed only as `Personal`.

## Presence States

The supported states are:

- `leave`
- `lunch`
- `driving`
- `on_site`
- `personal`
- `meeting`
- `in_office`

User-facing labels are:

- Leave
- Lunch
- Driving
- On site
- Personal
- Meeting
- In office

When multiple sources are active, resolve them in this order:

1. Leave
2. Lunch
3. Driving
4. On site
5. Personal
6. Meeting
7. In office

The status calculation uses Australia/Melbourne local date and time.

### Leave

Leave is active when either:

- Zoho People reports an approved active absence for the technician.
- A dispatcher or technician has an active manual Leave override.
- As a safe fallback when Zoho People is unavailable, Outlook has an active
  out-of-office event that is clearly leave or absence.

Zoho People is authoritative when configured. Manual Leave supports a required
end date/time and optional safe reason label such as `Annual leave`, `Sick`, or
`Unavailable`. The wallboard may show the safe leave type and return time.

Use a separate server-side Zoho People OAuth service configuration. Do not reuse:

- The signed-in user's Zoho login token.
- MSP Central API OAuth credentials or refresh token.
- Microsoft Graph application credentials.

If Zoho People is not configured or unavailable, the feature remains functional
through Outlook fallback and manual Leave. The wallboard shows a subtle stale
source warning rather than failing the whole page.

### Lunch

Lunch is a manual timed override:

- Starting Lunch creates a 30-minute override beginning immediately.
- The UI shows the remaining time.
- The override expires automatically after 30 minutes.
- When it expires, the calculated schedule status resumes without manual action.
- A dispatcher can end Lunch early.
- The authenticated technician API supports the same action for the native app.

### Driving

Driving is calculated from the existing onsite appointment travel windows:

- Before the job: appointment start minus `travelToSiteMinutes` through the job
  start.
- After the job: appointment end through appointment end plus
  `travelBackToOfficeMinutes`.
- Travel buffers use the existing rounded travel values.
- Remote and In-house bookings never create Driving status.
- If a travel estimate is missing, do not invent Driving presence; surface a
  small data warning instead.

Safe context may show `To <customer/site>` or `Returning to <base office>`.

### On Site

On site is active during the actual start/end time of an `Onsite` booking.

The safe context may show the customer/site and scheduled end time. Selection,
priority colour, travel buffers, and timeline rendering continue to use the
existing booking data.

### Personal

Personal is active during a timed Outlook event that is:

- Marked with `sensitivity` of `private` or `personal`, or
- Categorised `Personal`.

The appointment model must retain only the classification fields needed to derive
this state. Private event content remains redacted in all Command Centre views.
The wallboard displays only `Personal` and the end time.

Ignore events whose Outlook `showAs` is `free`.

### Meeting

Meeting is active during a timed Outlook event that:

- Is not linked to an MSP Central request.
- Is not classified as Personal or Leave.
- Is not all-day.
- Does not have `showAs: free`.

Meeting may show the event subject when the event is not private. It also shows the
end time or remaining duration.

Linked Remote and In-house service appointments remain `In office`; they are not
relabelled as Meeting.

### In Office

In office is the default when no higher-priority state applies.

It also applies during:

- Linked Remote bookings.
- Linked In-house bookings.
- Empty calendar time.

The wallboard shows the technician's configured base office.

## Conflicts

Presence resolution always produces one primary state. When two meaningful sources
overlap, add a non-blocking conflict indicator to the technician panel.

Examples:

- An onsite booking overlaps a meeting.
- Driving time overlaps a personal booking.
- Lunch overlaps an onsite booking.

The higher-priority state remains visible. The indicator describes the other
active state without revealing private event content.

## Persistence

Add a `technician_presence_overrides` table to Supabase.

Required fields:

- `id`
- `staff_profile_id`
- `status` limited to `lunch` or `leave`
- `starts_at`
- `ends_at`
- `reason`
- `source` limited to `dispatch`, `technician_app`, or `system`
- `created_by_email`
- `created_at`
- `updated_at`
- `cleared_at`

Only active, non-expired, non-cleared overrides participate in presence
calculation. Keep expired rows for audit history.

The service role is the only database role with direct table access. Browser and
native clients use authenticated server APIs.

Do not persist the derived `Driving`, `On site`, `Personal`, `Meeting`, or
`In office` values. Calculate them from live appointments and active overrides so
the status cannot drift from the calendar.

## Server Boundaries

Create a focused presence module that:

- Accepts technicians, appointments, requests, active overrides, leave records,
  and the current time.
- Returns one `TechnicianPresence` per enabled technician.
- Contains no React or database code.
- Handles precedence, safe labels, end times, conflict indicators, and source
  freshness.

Create a presence repository responsible only for reading and writing manual
overrides.

Create an optional Zoho People client responsible only for reading approved leave.
It must fail independently so a People outage does not remove the calendar.

Create authenticated internal APIs for:

- Reading the latest wallboard snapshot.
- Starting Lunch for 30 minutes.
- Starting a manual Leave override.
- Clearing the caller's or a selected technician's active manual override.

The dispatch screen can act for any enabled technician. The native technician API
may act only for the authenticated technician unless the caller is an admin.

## Refresh Behaviour

- The wallboard loads an authenticated server-rendered initial snapshot.
- The client refreshes the snapshot every 30 seconds while visible.
- The on-screen clock and remaining-time labels update every minute without a page
  reload.
- Use `cache: "no-store"` for the live wallboard snapshot.
- Pause polling while the tab is hidden and refresh immediately when it becomes
  visible.
- Show `Live` and the last successful refresh time.
- If refresh fails, preserve the last successful data and show `Update delayed`.
- Do not blank or reload the entire wallboard for a transient source failure.

## Dispatcher Controls

Add a compact status action associated with each technician on `/dispatch`.

Actions:

- Start Lunch (30 min)
- End Lunch
- Set Leave
- Clear Leave

Set Leave opens a small dialog with leave type/reason and required end date/time.
These controls update the shared presence API, so `/wallboard` reflects the change
on its next poll.

Do not add Meeting, Personal, Driving, On site, or In office as manual override
buttons in V1.

## Native App Contract

The server API must support the native EGIT Technician App without requiring a
web-view implementation:

- Read the authenticated technician's current presence.
- Start Lunch for 30 minutes.
- End Lunch early.
- Set or clear manual Leave when permitted.

Native push notifications are outside this wallboard change. Existing schedule
notification work remains separate.

## Error And Privacy Handling

- A failed Zoho People read does not fail the wallboard.
- A failed Outlook read preserves the last client snapshot and shows an update
  warning.
- Invalid or expired overrides are ignored.
- Reject overrides for unknown or disabled technicians.
- Reject Leave end times that are not later than the start time.
- Never return private Outlook content from the wallboard API.
- Keep all service credentials server-side.
- Protect every mutation and snapshot endpoint with the existing Command Centre
  allowlist authorization.

## Testing

Unit tests cover:

- Every individual state.
- The full precedence order.
- Lunch expiry at 30 minutes.
- Manual Leave start/end and clear behaviour.
- Travel-before and travel-after Driving windows.
- Remote and In-house jobs resolving to In office.
- Private/personal Outlook classification without content leakage.
- Non-ticket Outlook events resolving to Meeting.
- Free Outlook events being ignored.
- Conflict indicators.
- Australia/Melbourne time boundaries.

Repository and API tests cover:

- Active override reads.
- Lunch creation with a 30-minute expiry.
- Leave validation and persistence.
- Clearing an override.
- Authentication and technician ownership.
- Zoho People failure fallback.
- Redacted wallboard API responses.

Component/page tests cover:

- `/wallboard` authorization.
- Absence of the request queue and detail drawer.
- Presence panels for all enabled technicians.
- Full-width Day and Week calendar rendering.
- Manual status controls in `/dispatch`.
- Delayed-update state preserving the prior snapshot.

Browser verification covers:

- 1920x1080 at 100% browser zoom.
- No normal page scrolling.
- All four presence panels visible.
- The calendar filling the remaining viewport.
- Current-time line, elapsed shading, priority colours, and travel buffers.
- Lunch appearing on the wallboard after being started in Dispatch.
- Lunch reverting automatically after expiry using a controlled test time.

## Deployment

- Apply the Supabase migration before deploying code that writes overrides.
- Add separate Zoho People environment variables only when a dedicated People
  service OAuth client and refresh token are available.
- Deploy the authenticated wallboard and manual status flow even when Zoho People
  is not yet configured.
- Run the full test suite, ESLint, production build, and production browser
  verification before completion.

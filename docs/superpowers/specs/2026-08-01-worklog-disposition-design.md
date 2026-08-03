# Work Log Disposition Design
## Goal

Prevent scheduled Helpdesk jobs from being left in limbo after a Work Log is submitted. The dispatcher web app and native technician app must require a clear ticket outcome whenever the ticket is not completed.

## Required outcomes

Every Work Log submission for a scheduled request must choose exactly one outcome:

1. **Complete ticket** saves the Work Log and resolves the MSP Central request.
2. **Return to queue** saves the Work Log, clears the current schedule, leaves the request open, and returns it to the Command Centre unscheduled queue. The existing technician assignment may remain.
3. **Book forward** saves the Work Log and requires a new technician, date, start time, end time, and booking type. The current booking is replaced by the new booking.
4. **Transfer / escalate** saves the Work Log, requires a destination technician or escalation target plus a reason, clears the current booking, and leaves the request open for the new owner.

An unscheduled request can receive a Work Log without another disposition because it is already visible in the queue. Once a request has a booking, a non-completing Work Log cannot be submitted without one of the three continuing outcomes.

## Shared contract

Browser and native app submissions use the same server-side command and validation. The command includes Work Log content plus a `disposition` value:

- `complete`
- `return_to_queue`
- `book_forward`
- `transfer_escalate`

`book_forward` carries the replacement booking fields. `transfer_escalate` carries the target and reason. The server rejects an incomplete scheduled-job command without a valid disposition using a structured validation response that both clients can render.

The server, not either UI, is authoritative. This prevents an old or offline phone build from bypassing the rule.

## Browser flow

The existing Work Log dialog gains an **Outcome** section below the Work Log fields. The outcome uses a compact single-choice control:

- Complete ticket
- Return to queue
- Book forward
- Transfer / escalate

Selecting Book forward reveals the existing scheduling controls inside the dialog. Selecting Transfer / escalate reveals target and reason fields. The primary action label reflects the selected outcome. There is no plain Save Work Log action for a scheduled job.

For an unscheduled request, **Save Work Log** remains available because the ticket is already safely in the queue.

## Native technician flow

After entering a Work Log on a scheduled job, the native app shows the same four outcomes before submission. Book forward uses a mobile date/time and technician form. Transfer / escalate uses a target selector and required reason. Completion remains a single deliberate action, not the default.

Offline submissions store the entire Work Log and disposition command together. The app must not mark the operation complete locally until the server accepts both parts.

## Writeback and recovery

MSP Central Work Log and scheduling/status updates are separate API operations, so they cannot be assumed atomic. Command Centre stores a disposition operation with an idempotency key and these states:

- `pending`
- `worklog_saved`
- `completed`
- `recovery_required`

The server saves the operation before calling MSP Central. It records progress after the Work Log succeeds, then applies the chosen status/schedule/assignment change. A retry reuses the same idempotency key and does not create a second Work Log.

If the second operation fails, the ticket is surfaced as a sync issue and the operation is retried. The UI reports that the Work Log was saved but the outcome still needs recovery; it never reports full success or silently leaves the old booking untouched.

## Queue and calendar effects

- Return to queue removes the appointment and makes the open request visible in Unscheduled Requests.
- Book forward replaces the current appointment and recalculates travel, conflicts, health, and phone schedule data.
- Transfer / escalate removes the appointment, updates ownership, and places the open request in the queue for the new owner.
- Complete ticket resolves the request and removes its active booking.
- Every successful outcome emits the existing schedule/request change event so mobile refresh and technician notifications remain consistent.

## Validation and safety

- Work Log notes and positive charged time remain required.
- Billable Work Logs remain customer-facing; Internal work remains internal.
- Book-forward end time must be after start time.
- Transfer / escalate target and reason are required.
- Existing Outlook-only events cannot create MSP Central Work Logs.
- Self-notification suppression and office-hours notification rules remain unchanged.

## Tests

Coverage must include:

- scheduled job rejects a Work Log with no disposition
- unscheduled request can save a Work Log without a new disposition
- complete resolves and removes the booking
- return to queue clears the booking and exposes the request in the queue
- book forward replaces the booking without duplicating onsite note time
- transfer / escalate updates ownership and clears the booking
- partial MSP failure creates a recoverable operation without duplicating the Work Log
- browser dialog conditionally requires the correct fields
- native app presents and submits all four outcomes
- offline native retry preserves the chosen outcome and idempotency key

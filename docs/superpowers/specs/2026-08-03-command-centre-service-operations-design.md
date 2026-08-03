# Command Centre Service Operations Design

**Date:** 3 August 2026  
**Status:** Approved for implementation planning

## Purpose

Expand Command Centre into EGIT's fast operational layer over MSP Central without recreating the full Helpdesk product. Command Centre should simplify daily dispatch, triage, communication, technician work, escalation, closure, customer context, assets, and integration recovery. MSP Central and the connected business systems remain authoritative for their respective records.

This design adds a dedicated Dispatch Queue alongside the existing calendar-first Dispatch Board. It also establishes a reliable background-write architecture so staff can act immediately without losing changes or creating duplicates when an external service is slow or unavailable.

## Product Boundary

Command Centre owns the operational experience and orchestration. It does not become a replacement CRM, endpoint manager, calendar service, survey platform, or Helpdesk administration console.

### Systems of record

| System | Ownership |
| --- | --- |
| MSP Central Helpdesk | Requests, statuses, priorities, technician ownership, Work Logs, request notes, Solutions, merges, and request lifecycle |
| Zoho CRM Accounts | Customers, contacts, addresses, account ownership, important account context, and service tags |
| MSP Central Endpoint | Managed assets, endpoint state, device details, alerts, and secure remote-control launch |
| Microsoft Outlook | Technician calendars, meetings, personal appointments, leave events, and Command Centre-created bookings |
| Zoho Survey | Customer follow-up surveys and responses |
| Zia | Classification assistance and ranking of approved MSP Central Solutions |
| Command Centre database | Tracks, template mappings, unread state, external identity mappings, durable action queue, idempotency records, audit events, integration health, and short-lived operational summaries |

All OAuth credentials and provider tokens remain server-side. Browser and mobile clients call protected Command Centre APIs and never call MSP Central, CRM, Endpoint, Outlook, or Zoho Survey directly.

## Application Structure

### Dispatch Board

The existing `/dispatch` experience remains calendar-first and focused on scheduling.

- Technician day and week schedules
- Drag-and-drop booking and rescheduling
- Travel buffers, conflicts, working hours, and availability
- A compact left panel containing only requests marked `Ready to Schedule`
- Fast access to the shared ticket workspace
- Immediate visual scheduling followed by reliable background writeback

The Board does not contain the complete triage queue. Scheduling a request removes it from Ready to Schedule immediately. Returning a request to the queue restores it to the appropriate queue state.

### Dispatch Queue

Add `/dispatch/queue` as the full operational inbox.

Queue views:

- New / Unassigned
- My Queue
- Assigned, filterable by technician
- Updated
- Waiting
- SLA Risk
- Failed Sync, restricted to dispatch and admin users

Each request shows the reason it needs attention, including new customer reply, unassigned, overdue SLA, failed sync, incomplete Track, missing classification, or another actionable warning. Counts refresh automatically and reflect the active filters.

Queue actions include assignment, status and priority changes, scheduling, rescheduling, merge, escalation, return to queue, and closure. The same actions remain available in the ticket workspace.

### Shared Ticket Workspace

Opening a request from either screen launches a large workspace with these sections:

1. **Overview** - request summary, customer, site, schedule, SLA, assignment, booking type, travel, contact actions, and quick actions.
2. **Comms** - customer conversation and internal notes, clearly separated.
3. **Work Log** - labour, rounded time, work type, visibility, outcome, and solution handling.
4. **Tracks** - mandatory operational checklist and captured evidence.
5. **Assets** - related MSP Central Endpoint devices and remote-control launch.
6. **History** - user actions, external writes, retries, failures, and reconciliation events.

Work Log remains separate from Comms. Customer replies and internal notes must never be presented as labour entries.

## Ticket Templates And Classification

Templates define:

- Default priority and status
- Default booking type and expected duration
- Required request information
- Default assignment rules
- Applicable Track
- Customer communication template
- Closure requirements

Incoming requests are classified in this order:

1. Deterministic template rules
2. Zia classification suggestion
3. Manual dispatcher classification

Zia may automatically apply a template and Track only when confidence is at least 90 percent. Lower-confidence requests are marked `Needs classification`. Dispatchers can override any automatic result, and every automatic decision and manual override is audited.

Requests created directly in Command Centre apply the selected template immediately.

## Tracks

Tracks are versioned, reusable workflows associated with ticket templates. Examples include user onboarding, offboarding, device deployment, site installation, security remediation, and new-customer setup.

Track item types:

- Checkbox
- Required text
- Choice
- Date or time
- Asset selection
- Evidence or photo
- Approval
- Completed / Not applicable outcome

Every mandatory item must be resolved before closure. An item can be `Completed` or `Not applicable`; selecting Not applicable requires a reason. This permits one Track to support customers with different service combinations without allowing technicians to silently skip work.

Zoho CRM Account tags define the services a customer uses. Those tags control conditional Track sections. Template and Track versions are retained so historical tickets continue to show the exact workflow used at the time.

## Closure And Escalation

A scheduled request cannot close until:

- A Work Log has been submitted
- Recorded time has been rounded up to the next 15-minute increment
- Onsite chargeable time includes applicable travel
- Every mandatory Track item is Completed or Not applicable with a reason
- An outcome has been selected
- A customer-facing solution has been supplied when required by the template

Supported outcomes:

- Complete ticket
- Return to queue
- Book forward
- Transfer / escalate

No scheduled request may be left without a completion, queue, future booking, or escalation outcome.

The escalation workspace requires a destination technician or team, reason, urgency, handover summary, and next action. The receiving technician receives the complete ticket context.

When `Use as solution` is selected during completion, the Work Log resolution is sent to the customer and submitted to the MSP Central Solutions review flow. It does not become approved knowledge automatically.

## Customer Follow-up

Zoho Survey sends customer follow-up after eligible successful closures. Eligibility is controlled by ticket-template and customer rules, with a configurable contact cooldown to prevent survey fatigue.

Survey delivery and response are linked to the request, customer, technician, and closure event. Internal, duplicate, test, no-contact, or otherwise excluded requests do not trigger surveys.

## Customer And Site Context

The workspace enriches MSP Central requests using Zoho CRM Accounts.

Visible context can include:

- Account and contact details
- Service tags
- Site addresses
- Account owner
- Important customer and site notes
- Enabled services
- Recent relevant customer history

Matching uses stored external IDs first, then verified email or domain mappings. Name-only matches are suggestions requiring confirmation. Missing or ambiguous matches create a review warning instead of silently linking the wrong account.

## Asset Context And Remote Control

MSP Central Endpoint supplies devices related to the request customer, site, requester, or explicitly selected asset.

Visible asset data can include:

- Device name and assigned user
- Operating system
- Online or offline state
- Last check-in
- Serial number and warranty data where available
- Active endpoint alerts
- Previous requests associated with the device
- Direct endpoint record link

The workspace provides a secure remote-control launch when MSP Central Endpoint supports it. Command Centre requests a short-lived server-generated launch action. It never stores or exposes reusable remote-control credentials or provider tokens.

## Knowledge Suggestions

MSP Central Solutions is the approved knowledge source. Zia ranks relevant approved Solutions using request context, classification, customer services, affected assets, and technician notes.

Technicians can:

- Open a suggested Solution
- Insert approved content into customer Comms
- Reference it from a Work Log
- Submit a completed-ticket solution for review

Zia cannot publish knowledge or send customer content without a deliberate user action.

## Durable Writeback

Every external mutation is recorded as a durable action before provider writeback. Each action includes:

- Unique idempotency key
- Action type and target system
- Ticket and external record identifiers
- Initiating user
- Intended payload and safe payload fingerprint
- Source record version
- Creation time, attempts, and next retry time
- Current state: Queued, Syncing, Synced, Retrying, Review required, or Cancelled

The UI applies eligible changes immediately and shows a visible syncing state. A server-side worker writes to the owning system. A scheduled recovery worker catches actions interrupted by deployment, timeout, provider outage, or worker failure.

Retryable failures use controlled increasing delays. Authentication failures mark the connector as requiring attention. Permanent validation or conflict failures enter Review required. Actions never silently disappear.

The same idempotency key is reused across retries so Work Logs, bookings, Comms messages, surveys, and other mutations cannot be duplicated. Multi-system actions track each provider result independently and are not reported as fully synced until every required step succeeds.

## Failed Action Review

Dispatch and admin users can:

- Retry an action
- Review and correct permitted fields
- Cancel an obsolete action
- Open the affected ticket
- Inspect provider-safe error details
- See which parts of a multi-system action succeeded

Corrections create a new audit event without destroying the original failed attempt.

## Integration Health

The Integrations screen covers MSP Central Helpdesk, MSP Central Endpoint, Outlook, Zoho CRM, Zoho Survey, technician push, and technician email.

Each connector shows:

- Connected, Degraded, Unavailable, Authentication required, or Stale
- Last successful read
- Last successful write
- Pending and failed action counts
- Recent safe error summary
- Test connection action
- Link to affected actions

Ticket screens and global navigation show subtle stale-data indicators when relevant. Provider outages do not produce repeated duplicate warning banners.

## Audit Timeline

The audit timeline records:

- User intent and initiating interface
- Local acceptance
- Automatic classification decisions
- Manual overrides
- External write attempts
- External response identifiers
- Success, retry, rejection, correction, cancellation, and reconciliation
- Merge, assignment, schedule, status, Comms, Work Log, Track, asset-link, escalation, and survey events

Secrets, refresh tokens, full provider payloads, and sensitive headers are never stored in the audit log.

## Refresh And Reconciliation

The Board, Queue, ticket workspace, wallboard, and technician app share server-authoritative operational state.

- Local actions update immediately.
- Successful external writes reconcile provider IDs and versions.
- Merge, reschedule, assignment, status, priority, Comms, and customer replies invalidate affected views immediately.
- Provider polling or event ingestion catches changes made outside Command Centre.
- Active views refresh automatically and also support manual refresh.
- Unread customer replies remain unread until explicitly viewed.
- Stale records show their last successful provider sync time.

## Permissions

### Dispatch and admin

- Access all queues and technicians
- Perform scheduling, assignment, merge, escalation, and closure actions
- Review failed actions and integration health
- Manage templates, Tracks, classification rules, and survey eligibility

### Technicians

- Default to My Queue, Today, Upcoming, and Assigned to Me
- Access their assigned ticket workspace
- Use Comms, Work Logs, Tracks, assets, remote control, and permitted ticket actions
- See their own pending and failed offline actions

The first selected technician remains the MSP Central request owner for multi-technician work. Additional crew receive Command Centre, Outlook, and mobile bookings and can submit their own Work Logs using their own technician identity.

## Notifications

Notify technicians for assignment, reassignment, schedule changes, cancellation, customer reply, dispatcher/internal note, priority change, status change, escalation, and updates made by another person.

- No self-notifications
- Technician email may send at any time
- Normal phone push operates Monday to Friday, 9:00 AM to 5:00 PM Australia/Melbourne
- Approved Advanced Works/Viridian assignment alerts may push outside office hours
- Notification taps deep-link to the exact request and relevant workspace section

## Delivery Sequence

### Slice 1: Reliability foundation

Durable action queue, idempotency, audit timeline, integration health, failed-action review, stale indicators, and immediate refresh.

### Slice 2: Dispatch Queue and workspace

Separate Queue page, individual queues, quick ticket actions, ticket workspace, Comms separation, unread indicators, and automatic refresh.

### Slice 3: Templates, Tracks, and closure

Ticket templates, high-confidence classification, mandatory Tracks, closure guardrails, escalation, and solution submission.

### Slice 4: Connected context

Zoho CRM Account enrichment, service tags, MSP Central Endpoint assets, and secure remote-control launch.

### Slice 5: Knowledge and follow-up

Zia suggestions, MSP Central Solutions review flow, and Zoho Survey automation.

### V2

- Problem linking and coordinated affected-customer updates
- Recurring work generation and scheduling

## Testing And Release Safety

Each slice must include unit, integration, and browser tests appropriate to its risk. Critical end-to-end scenarios include:

- Duplicate Work Log, booking, and message prevention
- Worker interruption and retry recovery
- Partial multi-system success
- Merge and immediate queue refresh
- Customer reply ingestion and unread state
- Template confidence and manual override
- Track closure blocking and Not applicable reasons
- CRM account and Endpoint identity ambiguity
- Secure remote-control launch authorization
- Survey eligibility and cooldown
- Role restrictions
- Mobile offline mutation recovery

Production rollout should use feature flags per slice, a small approved staff cohort, visible integration health, and a tested rollback path. No slice should enable provider writes until its idempotency and failed-action recovery paths are verified against controlled test records.

## Explicitly Deferred

- Full Helpdesk administration
- SLA policy administration
- Technician account administration
- Full CRM editing
- Full endpoint-management replacement
- Contract and purchasing administration
- Custom report builder
- Zia configuration management
- Problem linking until V2
- Recurring work until V2


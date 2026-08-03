# Command Centre Day 1 hardening

## Locked product decisions

- Work Log records labour, charged time, billing type, and the required ticket outcome only.
- Comms is the separate customer conversation surface. It shows requester replies and internal notes and can send a customer-facing reply or add an internal note.
- Completing a ticket can mark the Work Log text as the ticket solution. That text is written to the MSP Central resolution and sent to the customer as the completion response. It remains suitable source material for Zia without bypassing the Solutions approval/topic workflow.
- The left panel can switch between Unscheduled and Assigned views and can be narrowed to one technician.
- Queue cards can open a large ticket workspace without relying on the right drawer.
- Day-view overlaps use vertical lanes. Every booking stays visible and selectable without hover.
- Command Centre refreshes live queue data while open and after mutations such as merge, reschedule, communication, and ticket creation.
- Technician email notifications are allowed at any hour. Phone push notifications retain the Monday-Friday 9:00 AM-5:00 PM guard, except the already-approved Advanced Works/Viridian after-hours assignment case.

## Ticket workspace

The ticket workspace is a large modal with Details and Comms tabs plus direct Work Log and Helpdesk actions. Details preserves safe clickable links from the MSP Central request description. Comms uses MSP Central request notes: customer-facing notes are sent to the requester through the Helpdesk notification flow, while internal notes remain technician-only.

## Reliability

The timeline owns its vertical scroll so extra overlap lanes are never clipped by the page shell. Reschedule reuses the existing confirmation and writeback path. Refresh reconciles new server data into local state while preserving the currently selected ticket when possible.

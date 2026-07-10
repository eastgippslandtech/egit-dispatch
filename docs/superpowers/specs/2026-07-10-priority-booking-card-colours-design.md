# Priority Booking Cards and Booking Types

## Goal

Make each booking card's full surface communicate the priority of its linked dispatch request while preserving the current card layout and interaction styling. Add an explicit booking type and reserve automatic note time for every Onsite booking.

## Priority Palette

- Critical: red/rose
- High: yellow/amber
- Medium: green/emerald
- Low: blue/sky
- Booking without a linked request priority, including Outlook-only events: neutral slate

Colours will use the existing dark-interface treatment: tinted backgrounds, coordinated borders, and high-contrast light text rather than solid bright fills.

## Implementation Design

Add one shared priority-card tone helper in the Command Centre component module. It accepts a request priority or no priority and returns the complete base colour treatment for a booking card.

Use the helper for every booking-card presentation in Command Centre:

- Day timeline appointment cards
- Week-view appointment cards
- The front card in an overlapping appointment stack
- Individual cards inside the overlap detail popover

The priority tone remains the base card surface in selected and warning states. Selection adds the existing cyan ring and raised stacking treatment. Conflicts retain their warning icon, overlap badge, and conflict label. Search matching/dimming, drag-and-drop, sizing, positioning, content, and travel extensions remain unchanged.

## Data Flow and Fallback

Appointments continue to obtain priority through their linked `DispatchRequest`; priority is not duplicated on the appointment. If the request is missing or the event is Outlook-only, the helper returns the neutral slate treatment.

## Booking Type

Add a shared booking type with exactly three user-facing values:

- Remote
- Onsite
- In house

Store the type on dispatch requests and appointments so it survives scheduling and moving. Existing request data is normalised into these values: explicitly non-onsite or remote sites become Remote, internal/workshop-style work becomes In house, and other site work becomes Onsite. Outlook-only events may have no booking type.

Show the booking type in the scheduling confirmation and on booking cards where space permits. New mock bookings use the request's type by default, and the dispatcher can choose a different type before confirming.

## Automatic Onsite Note Time

Treat the duration selected by the dispatcher as work time. Onsite bookings automatically reserve an additional 15 minutes at the end for notes. For example, a 60-minute Onsite job starting at 10:00 ends at 11:15. Remote and In house bookings receive no automatic note time.

The scheduling confirmation must show the work duration, the added 15-minute note allowance, and the resulting start/end time. Persist `noteTimeMinutes: 15` on Onsite appointments and `0` on other typed appointments. Conflict, out-of-hours, timeline width, and request scheduled-end calculations use the resulting end time, so the note allowance is genuinely protected.

Changing a pending booking type recalculates its end time and warnings immediately. Moving an existing booking preserves its stored total duration and note-time metadata without adding another 15 minutes.

## Testing

Add focused tests that prove booking cards receive the correct priority identity for Critical, High, Medium, and Low requests, plus the neutral fallback. Add scheduling tests for booking-type normalisation, default selection, type changes, the 15-minute Onsite extension, no extension for Remote and In house, and moving an existing Onsite appointment without double-adding note time. Tests should exercise rendered booking cards and the real scheduling functions. Run the focused scheduling and Command Centre test files, then the complete test and lint suites.

## Out of Scope

- Changing queue-card colours or priority chips
- Changing priority values
- Live MSP Central or Outlook writeback
- Colouring travel-buffer extensions by priority
- Changing warning, selection, overlap, search, or drag-and-drop behavior

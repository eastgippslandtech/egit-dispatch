# Priority Booking Card Colours

## Goal

Make each booking card's full surface communicate the priority of its linked dispatch request while preserving the current card layout and interaction styling.

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

Appointments continue to obtain priority through their linked `DispatchRequest`. No appointment schema changes are required. If the request is missing or the event is Outlook-only, the helper returns the neutral slate treatment.

## Testing

Add focused tests that prove booking cards receive the correct priority identity for Critical, High, Medium, and Low requests, plus the neutral fallback. Tests should exercise rendered booking cards and avoid changing unrelated scheduling behavior. Run the focused Command Centre test file, then the complete test and lint suites.

## Out of Scope

- Changing queue-card colours or priority chips
- Changing priority values or MSP Central mappings
- Colouring travel-buffer extensions by priority
- Changing warning, selection, overlap, search, or drag-and-drop behavior

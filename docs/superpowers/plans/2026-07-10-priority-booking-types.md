# Priority Booking Cards and Booking Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colour every Command Centre booking card by linked-request priority, add Remote/Onsite/In house booking types, and automatically reserve 15 minutes of note time after new Onsite work.

**Architecture:** Add a small pure booking-domain module for type normalisation and note-time calculations, then make scheduling consume those values without changing travel logic. Keep priority colour selection in the Command Centre presentation module and layer selection, warning, overlap, and search states over the base priority tone.

**Tech Stack:** TypeScript 5, React 19.2, Next.js 16 App Router, Tailwind CSS 4, Vitest 4, Testing Library.

## Global Constraints

- Booking types are exactly `Remote`, `Onsite`, and `In house`.
- Critical is red/rose, High is yellow/amber, Medium is green/emerald, Low is blue/sky, and bookings without a linked request are neutral slate.
- The priority colour covers the full card surface while preserving the current dark translucent style.
- A new Onsite booking adds exactly 15 minutes after the selected work duration; Remote and In house add 0 minutes.
- Moving an existing booking must not add note time twice.
- Selection, warnings, overlaps, search dimming, drag/drop, and travel extensions must remain functional.
- Live MSP Central and Outlook writeback remain out of scope.
- Do not alter the user's existing changes in `src/app/mobile/mobile-app.tsx` or `src/app/mobile/page.test.tsx`.

---

### Task 1: Booking Type Domain Model

**Files:**
- Create: `src/server/dispatch/booking.ts`
- Create: `src/server/dispatch/booking.test.ts`
- Modify: `src/server/dispatch/types.ts`
- Modify: `src/server/msp-central/mappers.ts`
- Test: `src/server/msp-central/mappers.test.ts`

**Interfaces:**
- Produces: `BookingType = "Remote" | "Onsite" | "In house"`.
- Produces: `bookingTypeForRequest(request): BookingType`.
- Produces: `bookingTiming(workDurationMinutes, bookingType): { noteTimeMinutes; totalDurationMinutes; workDurationMinutes }`.
- Produces: `ONSITE_NOTE_TIME_MINUTES = 15`.

- [ ] **Step 1: Write failing booking-domain tests**

Add tests that require explicit stored values to win, `onsite: false` or a Remote site to map to Remote, Internal EGIT/workshop/in-house sites to map to In house, and ordinary site work to map to Onsite. Add timing expectations:

```ts
expect(bookingTiming(60, "Onsite")).toEqual({
  noteTimeMinutes: 15,
  totalDurationMinutes: 75,
  workDurationMinutes: 60,
});
expect(bookingTiming(60, "Remote").totalDurationMinutes).toBe(60);
expect(bookingTiming(60, "In house").totalDurationMinutes).toBe(60);
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm test src/server/dispatch/booking.test.ts`

Expected: FAIL because `./booking` and the `BookingType` fields do not exist.

- [ ] **Step 3: Add the type fields and pure helper implementation**

Extend `DispatchRequest` with `bookingType?: BookingType`. Extend `Appointment` with `bookingType?: BookingType`, `noteTimeMinutes?: number`, and `workDurationMinutes?: number`. Implement:

```ts
export const ONSITE_NOTE_TIME_MINUTES = 15;

export function bookingTypeForRequest(request: Pick<
  DispatchRequest,
  "bookingType" | "customer" | "onsite" | "site"
>): BookingType {
  if (request.bookingType) return request.bookingType;
  const location = `${request.site} ${request.customer}`.toLowerCase();
  if (request.onsite === false || location.includes("remote")) return "Remote";
  if (/internal egit|workshop|in[- ]house/.test(location)) return "In house";
  return "Onsite";
}

export function bookingTiming(workDurationMinutes: number, bookingType: BookingType) {
  const noteTimeMinutes = bookingType === "Onsite" ? ONSITE_NOTE_TIME_MINUTES : 0;
  return {
    noteTimeMinutes,
    totalDurationMinutes: workDurationMinutes + noteTimeMinutes,
    workDurationMinutes,
  };
}
```

Set `bookingType` in `mapMspCentralRequest` from the raw onsite/site/customer values through `bookingTypeForRequest`.

- [ ] **Step 4: Add mapper coverage and run GREEN**

Assert an onsite fixture maps to `bookingType: "Onsite"` and a non-onsite fixture maps to `bookingType: "Remote"`.

Run: `pnpm test src/server/dispatch/booking.test.ts src/server/msp-central/mappers.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the domain model**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- src/server/dispatch/booking.ts src/server/dispatch/booking.test.ts src/server/dispatch/types.ts src/server/msp-central/mappers.ts src/server/msp-central/mappers.test.ts
& 'C:\Program Files\Git\cmd\git.exe' commit -m 'feat: add dispatch booking types'
```

### Task 2: Onsite Note-Time Scheduling

**Files:**
- Modify: `src/server/dispatch/scheduling.ts`
- Modify: `src/server/dispatch/scheduling.test.ts`

**Interfaces:**
- Consumes: `BookingType`, `bookingTiming`, and `bookingTypeForRequest` from Task 1.
- Changes: `scheduleRequest` accepts optional `bookingType`; its `durationMinutes` remains work duration for new bookings.
- Changes: `moveAppointment` accepts optional booking metadata and uses the supplied total `durationMinutes` exactly once.

- [ ] **Step 1: Write failing scheduling tests**

Require a 60-minute Onsite request starting at 14:00 to produce an appointment ending at 15:15 with `workDurationMinutes: 60`, `noteTimeMinutes: 15`, and `bookingType: "Onsite"`. Add matching Remote and In house tests that end at 15:00 with zero note time. Add a move test for an existing 75-minute Onsite appointment that still ends 75 minutes after its new start, not 90 minutes later.

- [ ] **Step 2: Run the scheduling tests and verify RED**

Run: `pnpm test src/server/dispatch/scheduling.test.ts`

Expected: FAIL because new appointments still end after only the supplied duration and have no booking metadata.

- [ ] **Step 3: Implement new-booking timing and move metadata**

Inside `scheduleRequest`, resolve `bookingType ?? bookingTypeForRequest(request)`, call `bookingTiming(durationMinutes, resolvedType)`, build the slot from `totalDurationMinutes`, and store all three booking fields on the appointment.

Extend `moveAppointment` with optional `bookingType`, `noteTimeMinutes`, and `workDurationMinutes`. Continue building the slot directly from its `durationMinutes` argument; copy supplied metadata without calling `bookingTiming`, which prevents double addition.

- [ ] **Step 4: Run scheduling tests and verify GREEN**

Run: `pnpm test src/server/dispatch/scheduling.test.ts`

Expected: PASS, including the original timeline, warning, health, and travel-related scheduling tests.

- [ ] **Step 5: Commit scheduling behavior**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- src/server/dispatch/scheduling.ts src/server/dispatch/scheduling.test.ts
& 'C:\Program Files\Git\cmd\git.exe' commit -m 'feat: reserve onsite note time'
```

### Task 3: Booking Type Controls and Priority-Coloured Cards

**Files:**
- Modify: `src/app/dispatch/command-centre/prototype.tsx`
- Modify: `src/app/dispatch/command-centre/page.test.tsx`

**Interfaces:**
- Consumes: booking-domain helpers and the new appointment/request fields.
- Produces: `bookingPriorityCardTone(priority?: Priority): string` for all card variants.
- Produces: rendered `data-priority` and `data-booking-type` identities for stable behavioral tests.

- [ ] **Step 1: Write failing card and scheduling-modal tests**

Add rendered assertions for known linked and Outlook-only appointments:

```ts
expect(screen.getByTestId("timeline-appointment-appt-1")).toHaveAttribute("data-priority", "High");
expect(screen.getByTestId("timeline-overlap-appt-3")).toHaveAttribute("data-priority", "Medium");
expect(screen.getByRole("button", { name: /Outlook busy: supplier call/ })).toHaveAttribute("data-priority", "None");
```

Test the exported tone helper for Critical, High, Medium, Low, and undefined. Add a drag/drop confirmation test that opens the modal for an onsite request, finds a `Booking type` select defaulted to Onsite, displays `15 min notes`, and shows a 75-minute resulting window for 60 minutes of work. Change the select to Remote and require the note allowance to become 0 and the resulting end time to shorten by 15 minutes.

- [ ] **Step 2: Run the Command Centre tests and verify RED**

Run: `pnpm test src/app/dispatch/command-centre/page.test.tsx`

Expected: FAIL because cards lack priority/type identities and the modal lacks a booking-type control and note-time summary.

- [ ] **Step 3: Add pending booking timing state and modal controls**

Represent pending schedules with `bookingType`, `workDurationMinutes`, `noteTimeMinutes`, and total `durationMinutes`. For new requests default the type with `bookingTypeForRequest`; for moved appointments use stored metadata and derive legacy work duration as `total - (noteTimeMinutes ?? 0)`.

Change duration and type handlers to recalculate timing and warnings immediately. Pass total duration to warning detection, `workDurationMinutes` plus `bookingType` to `scheduleRequest`, and total duration plus stored metadata to `moveAppointment`.

Add a labelled Booking type select with Remote, Onsite, and In house options. Show `Work`, `Notes`, and `Total reserved` in the confirmation summary.

- [ ] **Step 4: Add one priority-tone map and apply it to every card variant**

Implement a static Tailwind map so classes are included in the build:

```ts
const bookingPriorityCardTones: Record<Priority, string> = {
  Critical: "border-rose-300/70 bg-rose-500/45 text-rose-50",
  High: "border-amber-300/70 bg-amber-400/40 text-amber-50",
  Medium: "border-emerald-300/65 bg-emerald-500/35 text-emerald-50",
  Low: "border-sky-300/65 bg-sky-500/35 text-sky-50",
};

export function bookingPriorityCardTone(priority?: Priority) {
  return priority
    ? bookingPriorityCardTones[priority]
    : "border-slate-300/35 bg-slate-500/25 text-slate-50";
}
```

Use it in `WeekAppointmentCard`, `TimelineAppointment`, `TimelineOverlapGroup`'s front card, and each overlap-detail card. Do not replace the priority background for selected or warning states; add the existing cyan ring and warning icon/badges as overlays. Add `data-priority` and `data-booking-type` to each rendered booking button and show a compact type label where the current card height permits it. Replace the misleading Scheduled/Warning/Conflict colour legend with the four priority colours while keeping warning/conflict cues on cards.

- [ ] **Step 5: Run focused UI tests and verify GREEN**

Run: `pnpm test src/app/dispatch/command-centre/page.test.tsx`

Expected: PASS with priority tones, booking type selection, and note-time recalculation covered.

- [ ] **Step 6: Commit the Command Centre UI**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add -- src/app/dispatch/command-centre/prototype.tsx src/app/dispatch/command-centre/page.test.tsx
& 'C:\Program Files\Git\cmd\git.exe' commit -m 'feat: colour bookings by priority'
```

### Task 4: Full Verification and Visual Check

**Files:**
- Modify only if verification exposes a defect in files already listed above.

**Interfaces:**
- Consumes the completed behavior from Tasks 1-3.
- Produces evidence that tests, lint, build, and the rendered dispatch board all pass.

- [ ] **Step 1: Run focused tests together**

Run: `pnpm test src/server/dispatch/booking.test.ts src/server/dispatch/scheduling.test.ts src/server/msp-central/mappers.test.ts src/app/dispatch/command-centre/page.test.tsx`

Expected: PASS with no warnings or unhandled errors.

- [ ] **Step 2: Run the complete automated checks**

Run: `pnpm test`, then `pnpm lint`, then `pnpm build`.

Expected: all commands exit 0.

- [ ] **Step 3: Verify in the browser**

Start the app with local auth disabled, open `/dispatch`, and confirm:

- High and Medium scheduled cards have distinct full-card amber and green treatments.
- An Outlook-only booking is neutral slate.
- Selection uses a cyan ring without removing the priority colour.
- The overlap stack keeps its conflict treatment while its front surface uses priority colour.
- Scheduling an Onsite request shows a 15-minute note allowance and reserves 75 minutes for 60 minutes of work.
- Switching the pending type to Remote or In house removes the 15-minute allowance.

- [ ] **Step 4: Review the final diff and status**

Run:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' diff HEAD~3 -- src/server/dispatch src/server/msp-central src/app/dispatch/command-centre
& 'C:\Program Files\Git\cmd\git.exe' status --short
```

Expected: only intended feature files plus the user's pre-existing mobile changes are present; no generated artifacts or secrets are added.

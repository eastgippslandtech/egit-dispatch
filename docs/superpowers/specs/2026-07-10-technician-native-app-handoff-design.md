# EGIT Command Centre Technician Native App Handoff Design

Date: 10 July 2026

## Purpose

Create a complete handoff package for Codex on a MacBook to build a proper EGIT technician field application for iOS and Android. The native app is a new client of Command Centre. It is not a WebView, Capacitor wrapper, PWA conversion, responsive copy of `/mobile`, or a mobile version of the dispatcher board.

The existing Next.js Command Centre remains the dispatcher and server-side integration application. Its `/mobile` implementation is a proven workflow reference and source of mock contracts, not the native UI implementation.

## Locked Product Boundary

The native application is technician-only.

It includes:

- Zoho sign-in for approved EGIT staff.
- My Schedule and technician workload.
- Job detail and service context.
- Persistent live timer and worklog summary.
- Internal and external repair/work notes.
- Status updates and job completion.
- Photos, camera capture, and file attachments.
- Parts used.
- Customer sign-off and signature capture.
- On-demand ETA and maps handoff.
- Phone, email, and Outlook event actions.
- Offline cache, mutation queue, retry, and sync status.
- Push notification foundations for later assignment and schedule alerts.
- Profile, diagnostics, and sign-out.

It excludes:

- The desktop Dispatch Health dashboard.
- Unscheduled request triage.
- Technician timeline scheduling or drag-and-drop dispatch.
- Dispatcher health filters.
- Full staff reallocation or route planning.
- Live technician tracking or a dispatcher map.
- Direct Microsoft Graph, MSP Central, Zoho service API, or Supabase service-role access from the device.

## Chosen Technology

Build one native TypeScript application with:

- React Native and the current stable Expo SDK.
- Expo development builds, not Expo Go, for native OAuth redirects and native modules.
- Expo Router for file-based native navigation.
- iOS and Android native projects generated through Expo prebuild only when required.
- `expo-auth-session` and the system browser for Zoho OAuth.
- `expo-secure-store` for the Command Centre mobile session and refresh material.
- `expo-sqlite` for cached jobs, drafts, timer state, attachments metadata, and the offline mutation queue.
- Native camera/image picker, document picker, location, notifications, linking, and network-state modules selected through `npx expo install` for SDK compatibility.
- React Native Testing Library for component tests.
- Maestro for end-to-end flows on iOS Simulator and Android Emulator.
- EAS development, preview/internal, and production build profiles.

Do not pin package versions in the handoff prompt. The Mac implementation must create the app using the current stable Expo template, then install Expo-managed packages with `npx expo install` so native package versions match the chosen SDK.

Official references:

- Expo OAuth guidance: https://docs.expo.dev/guides/authentication/
- Expo AuthSession: https://docs.expo.dev/versions/latest/sdk/auth-session/
- Expo SecureStore guidance: https://docs.expo.dev/guides/authentication/#storing-data
- Expo SQLite: https://docs.expo.dev/versions/latest/sdk/sqlite/
- Expo internal distribution: https://docs.expo.dev/build/internal-distribution/
- Zoho native OAuth with PKCE: https://www.zoho.com/developer/oauth/mobile-and-desktop-apps/overview.html

## Repository Placement

The native source should live in the existing Command Centre repository at:

```text
apps/technician-mobile/
```

The app must be independently installable and buildable. It may consume framework-neutral shared types and validation logic, but it must not import Next.js components, server-only modules, browser APIs, Auth.js runtime code, Tailwind UI, or desktop layout code.

Recommended boundaries:

```text
apps/technician-mobile/
  app/                    Expo Router routes
  src/components/         Native reusable UI
  src/features/           Schedule, jobs, timer, notes, evidence, parts, sign-off
  src/data/               Repository interfaces and adapters
  src/db/                 SQLite schema, migrations, queries, sync queue
  src/auth/               PKCE login, secure session, protected navigation
  src/api/                Command Centre API client and DTO validation
  src/theme/              Native Command Centre tokens
  src/testing/            Fixtures and test helpers
  assets/                 Native icon, splash, and notification assets
packages/
  command-centre-contracts/  Optional framework-neutral types and schemas
```

If converting the root project to a pnpm workspace would create unnecessary churn, the native app may initially keep copied contract files with a clear provenance header. Do not destabilize the working Next.js application merely to create a monorepo abstraction.

## Application Identity

- App display name: `Command Centre`
- Purpose label: `Technician`
- iOS bundle identifier: `au.com.egit.commandcentre`
- Android package: `au.com.egit.commandcentre`
- Deep-link scheme: `egitcommand`
- Production API base URL: `https://command.egit.com.au`
- Timezone: `Australia/Melbourne`
- Business hours reference: Monday-Friday, 9:00 AM-5:30 PM

If Apple or Google already has an application registered with the proposed identifier, stop and confirm the identifier before changing it. Bundle/package identifiers cannot be casually changed after store release.

## Native Experience

Use a touch-first, platform-native information architecture. Preserve the dark Command Centre identity, priority colours, status semantics, and EGIT branding, but do not reproduce the desktop three-panel layout.

Primary navigation:

1. Today
2. My Work
3. Sync
4. Profile

Screens and flows:

### Sign In

- Large cleaned EGIT Command Centre mark.
- Single `Sign in with Zoho` command.
- System-browser OAuth only.
- Friendly access-not-approved and session-expired states.
- No username/password form and no public signup.

### Today

- Selected date and previous/next/today controls.
- Current running timer bar pinned above content.
- Chronological job list with priority, booking type, time, customer/site, status, SLA warning, travel indicator, and sync state.
- Outlook-only events are clearly read-only.
- Pull to refresh and offline/stale-data indicator.

### My Work

- Sections for Today, Upcoming, Assigned to me, SLA risk, Waiting on me, and Recently completed.
- Search and compact filters suited to a phone.
- No dispatcher-wide technician board.

### Job Detail

- Request number, title, priority, status, booking type, SLA state, customer, site, contact, schedule, description, previous notes, travel, and Outlook link.
- Native actions for timer, call, email, maps, status, notes, evidence, parts, sign-off, and completion.
- Destructive or final actions require confirmation.
- Outlook-only events disable all MSP Central write actions.

### Timer

- Only one active timer per technician.
- Persistent timer state stored locally with `startedAt`, job ID, technician ID, and stable timer ID.
- The visible clock updates every second while foregrounded.
- Elapsed time is always recalculated from timestamps when the app resumes; it must not depend on a background JavaScript interval.
- Stopping opens a native worklog summary sheet.
- Worklog time rounds up to the next 15-minute increment while retaining actual elapsed time for transparency.

### Notes and Completion

- Worklog types: Billable, Internal, Non-billable.
- Internal and external note visibility must be modelled separately.
- Drafts persist locally before submission.
- Completion requires a meaningful work note unless an existing acceptable note is present.
- Completion can mark follow-up required.
- Failed saves preserve the draft and enter the sync queue.

### Evidence

- Take photo, choose photo, or attach document using native pickers.
- Show upload progress, queued, failed, and synced states.
- Store local file URIs only as long as required for upload/retry.
- Do not silently discard a captured file when upload fails.

### Customer Sign-off

- Customer name, acceptance, and drawn signature.
- Timestamp and job association.
- Clear confirmation before queueing.
- Signature is treated as sensitive job evidence.

### Parts

- Part name, optional SKU, quantity, notes, and queued/synced state.
- No inventory availability claims until a real inventory API exists.

### ETA and Maps

- Request foreground location only after the technician taps `Calculate ETA`.
- Do not start background location tracking.
- Do not persist exact GPS coordinates in job history or worklogs.
- Offer Apple Maps/Google Maps handoff even when location permission is denied.

### Sync

- Show last successful sync, cached-data age, pending action count, failed actions, retry, and safe diagnostics.
- Each mutation has a client-generated idempotency key.
- Process mutations in dependency order.
- A failed item remains inspectable and retryable.
- Never claim a queued action has reached MSP Central when it has only been saved locally.

## Data Architecture

Use repository interfaces so the app can run before live MSP Central writeback exists:

```ts
interface TechnicianRepository {
  getCurrentStaff(): Promise<MobileStaff>;
  listSchedule(range: DateRange): Promise<MobileJob[]>;
  getJob(jobId: string): Promise<MobileJob>;
  startTimer(command: StartTimerCommand): Promise<ActiveTimer>;
  stopTimer(command: StopTimerCommand): Promise<StoppedTimer>;
  saveWorklog(command: SaveWorklogCommand): Promise<MutationReceipt>;
  updateStatus(command: UpdateStatusCommand): Promise<MutationReceipt>;
  attachEvidence(command: AttachEvidenceCommand): Promise<MutationReceipt>;
  addPart(command: AddPartCommand): Promise<MutationReceipt>;
  saveSignOff(command: SaveSignOffCommand): Promise<MutationReceipt>;
  completeJob(command: CompleteJobCommand): Promise<MutationReceipt>;
}
```

Adapters:

- `MockTechnicianRepository`: deterministic fixtures for simulator development and automated tests.
- `CommandCentreApiRepository`: authenticated HTTPS calls to server-owned mobile endpoints.
- `OfflineTechnicianRepository`: wraps the active remote adapter, maintains SQLite cache, and queues safe mutations.

The UI must depend on the repository interface, never directly on fixture arrays or integration SDKs.

## Command Centre Mobile API Boundary

The app must call a protected server API on `command.egit.com.au`. The Next.js server remains the only component allowed to hold Graph, MSP Central, Supabase service-role, and confidential OAuth credentials.

Proposed versioned endpoints:

```text
POST   /api/mobile/v1/auth/exchange
POST   /api/mobile/v1/auth/refresh
POST   /api/mobile/v1/auth/revoke
GET    /api/mobile/v1/me
GET    /api/mobile/v1/jobs?from=&to=
GET    /api/mobile/v1/jobs/:jobId
POST   /api/mobile/v1/jobs/:jobId/timers/start
POST   /api/mobile/v1/jobs/:jobId/timers/:timerId/stop
POST   /api/mobile/v1/jobs/:jobId/worklogs
PATCH  /api/mobile/v1/jobs/:jobId/status
POST   /api/mobile/v1/jobs/:jobId/evidence/init
PUT    <signed upload URL>
POST   /api/mobile/v1/jobs/:jobId/evidence/complete
POST   /api/mobile/v1/jobs/:jobId/parts
POST   /api/mobile/v1/jobs/:jobId/sign-off
POST   /api/mobile/v1/jobs/:jobId/complete
POST   /api/mobile/v1/devices/push-token
```

The export must label these as proposed contracts. The existing repository does not yet implement live mobile writeback. Codex on the Mac must begin with the mock adapter and typed API client, then add server routes only where the available integration can truthfully support them.

## Authentication and Token Separation

Native login uses a dedicated Zoho mobile OAuth client and Authorization Code Flow with PKCE (SHA-256). Do not reuse the confidential web OAuth client secret inside the application.

Required flow:

1. App creates verifier/challenge and opens Zoho in the system browser.
2. Zoho redirects to the registered native callback/deep link.
3. App verifies OAuth state, then posts the authorization code, PKCE verifier, and exact redirect URI to `POST /api/mobile/v1/auth/exchange` over HTTPS.
4. Command Centre exchanges the code with Zoho, reads the Zoho identity server-side, and verifies the `ALLOWED_AUTH_EMAILS` policy.
5. Command Centre discards the provider login token after identity verification and never returns a Zoho access or refresh token to the app.
6. Command Centre returns a short-lived mobile access session plus rotating, revocable renewal material scoped only to Command Centre APIs.
7. Native Command Centre session material is stored in SecureStore.
8. API authorization and active staff access are rechecked server-side on every mobile request.

Keep these credentials and tokens separate:

- Zoho native login: user identity only.
- Microsoft Graph application token: server-side Outlook access only.
- MSP Central service token: server-side Helpdesk access only.
- Supabase service role: server-side data access only.

Approved initial staff:

- `simeon@egit.com.au`
- `mattd@egit.com.au`
- `jervy@egit.com.au`
- `riley@egit.com.au`

Matt's account is intentionally `mattd@egit.com.au`.

## Offline and Conflict Rules

SQLite persists:

- Staff summary and session-independent display metadata.
- Job list and job detail cache.
- Active timer state.
- Work-note drafts.
- Pending mutation envelopes.
- Evidence upload metadata and local URI while pending.
- Parts and sign-off drafts.
- Last sync cursor and timestamps.

Do not store service credentials, provider client secrets, raw Graph/MSP tokens, or unnecessary exact location history.

Mutation envelope fields:

- ID/idempotency key.
- Job ID.
- Action type.
- Versioned payload.
- Created time.
- Attempt count.
- Last error category and safe message.
- Dependency IDs.
- State: pending, syncing, failed, or synced.

Conflict handling:

- Server-authoritative status and schedule changes are shown to the user.
- Draft notes and evidence are not discarded during refresh.
- Non-mergeable completion/status conflicts require user review.
- Read-only Outlook events never accept queued write actions.

## Visual System

The app should feel related to Command Centre without copying its desktop composition.

- Dark navy/black operational palette.
- Cyan for navigation and selected state.
- Critical red, High amber, Medium green, Low blue.
- Outlook-only neutral slate.
- Booking types: Remote, Onsite, In house.
- Compact but touch-safe controls with a minimum practical touch target.
- Native sheets, lists, headers, date controls, alerts, permission prompts, and keyboard avoidance.
- No marketing page, decorative dashboard copy, oversized cards, or web-style sidebars.
- Support system text scaling, screen readers, colour-independent labels, reduced motion, light/dark system chrome, and safe areas.

## Platform Requirements

### iOS

- Xcode-managed simulator and physical-device development.
- Keychain-backed SecureStore.
- Camera, photo library, location-when-in-use, notifications, and document access usage descriptions.
- Universal/deep-link handling for OAuth and job links.
- TestFlight build profile.

### Android

- Android Studio emulator and physical-device development.
- Encrypted platform storage through SecureStore.
- Runtime permissions for camera, media/documents, location, and notifications where required by OS version.
- Android back-button and process-recreation behaviour.
- APK preview/internal profile and AAB production profile.

## Testing and Acceptance

Required automated layers:

- Unit tests for time rounding, timer restoration, status rules, DTO mapping, mutation ordering, idempotency, retry classification, and auth state transitions.
- React Native Testing Library tests for every primary screen and disabled/read-only state.
- SQLite migration and repository tests.
- Maestro end-to-end flows on both platforms.

Required E2E flows:

1. Approved Zoho sign-in and protected navigation.
2. Unapproved account blocked.
3. Today schedule loads for the signed-in technician only.
4. Job opens and native contact/maps actions are available appropriately.
5. Timer starts, app backgrounds/restarts, elapsed time restores, and timer stops once.
6. Worklog time rounds up to 15 minutes.
7. Offline note is queued, survives restart, retries, and syncs once.
8. Photo capture/upload failure retains the local item for retry.
9. Parts and customer sign-off queue and sync.
10. Outlook-only event remains read-only.
11. Session expiry refreshes or returns cleanly to sign-in without losing drafts.
12. Android hardware back and iOS gesture navigation do not lose unsaved work.

Definition of done for the initial native build:

- No WebView or embedded Command Centre website.
- iOS Simulator and Android Emulator run from the Mac.
- Development builds work on physical iOS and Android devices.
- Mock mode covers the complete field workflow.
- Auth architecture is PKCE-ready and contains no client secret.
- Offline cache and persistent timer work across restart.
- All visible controls work or are explicitly disabled with a reason.
- Typecheck, lint, unit/component tests, Expo Doctor, iOS build, Android build, and Maestro smoke flows pass.
- Preview builds can be installed through an approved internal distribution method.

## Handoff Export Contents

The final Windows-generated export should contain:

```text
command-centre-native-handoff/
  START-HERE.md
  CODEX-MAC-MASTER-PROMPT.md
  NATIVE-APP-SPEC.md
  API-CONTRACTS.md
  DATA-MODELS.md
  OFFLINE-SYNC.md
  AUTH-AND-SECURITY.md
  IOS-ANDROID-SETUP.md
  ACCEPTANCE-CHECKLIST.md
  REPOSITORY-MAP.md
  source-reference/
    mobile-types.ts
    mobile-services.ts
    mobile-page.test.tsx
    dispatch-types.ts
    booking.ts
    travel.ts
    staff-profiles.ts
    mock-data.ts
    graph-mapper.ts
    msp-central-mapper.ts
  fixtures/
    sanitised mock JSON
  assets/
    existing usable brand assets
```

The ZIP must exclude:

- `.env.local` and all real environment files.
- OAuth client secrets, refresh tokens, access tokens, and service credentials.
- Supabase service-role keys or database passwords.
- `node_modules`, `.next`, build outputs, coverage, caches, `.vercel`, and platform signing credentials.
- Unsanitised customer/API response data.

## Mac Codex Guardrails

The master prompt must explicitly tell Codex on the Mac to:

- Inspect the supplied source reference before scaffolding.
- Build under `apps/technician-mobile` in the existing repository.
- Preserve the web Command Centre and avoid unrelated refactors.
- Never use a WebView, iframe, Capacitor, or website wrapper.
- Never place confidential credentials in the app bundle.
- Use current official Expo and Zoho documentation rather than guessed package APIs.
- Use a mock repository until truthful server endpoints exist.
- Write tests before behaviour changes and run verification on both platforms.
- Stop and report when Apple, Google, Zoho, MSP Central, Graph, or signing credentials are required from the user.

## Known External Dependencies

The Mac implementation will eventually require:

- Apple Developer team access for device builds/TestFlight.
- Google Play Console access for internal/production tracks.
- Expo/EAS account choice or an explicit local-only build decision.
- A dedicated Zoho mobile OAuth client configured for the final redirect URI.
- Final Command Centre mobile session exchange design.
- Live MSP Central API credentials and confirmed write endpoints before real field writeback.
- Push notification credentials before production notifications.

These dependencies must not block the mock native application, repository architecture, offline store, timer, UI, or automated tests.

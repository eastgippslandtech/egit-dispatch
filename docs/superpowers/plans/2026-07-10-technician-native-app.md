# EGIT Command Centre Technician Native App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a proper technician-only iOS and Android Command Centre application with native field workflows, persistent timers, offline sync, and a protected Command Centre API boundary.

**Architecture:** Add an independent Expo Router application under `apps/technician-mobile`. Native UI depends on a typed `TechnicianRepository`; a mock adapter enables complete development immediately, while a Command Centre API adapter and SQLite wrapper provide the production boundary and offline operation. The existing Next.js app remains the server-side owner of Zoho identity verification, Microsoft Graph, MSP Central, Supabase service credentials, and mobile API authorization.

**Tech Stack:** Current stable Expo SDK, React Native, Expo Router, TypeScript, `expo-auth-session`, `expo-secure-store`, `expo-sqlite`, Expo camera/image/document/location/notifications/linking modules, React Native Testing Library, Jest, Maestro, EAS Build.

## Global Constraints

- App display name is `Command Centre`; technician context is shown inside the app.
- iOS bundle identifier and Android package are `au.com.egit.commandcentre` unless an existing store registration conflicts.
- Deep-link scheme is `egitcommand`.
- Production API base URL is `https://command.egit.com.au`.
- Timezone is `Australia/Melbourne`.
- Approved accounts are `simeon@egit.com.au`, `mattd@egit.com.au`, `jervy@egit.com.au`, and `riley@egit.com.au`.
- Never use a WebView, iframe, Capacitor, PWA wrapper, or embedded website.
- Never ship OAuth client secrets, Microsoft Graph credentials, MSP Central service tokens, Supabase service-role keys, or signing credentials in the app bundle.
- Use a dedicated Zoho native OAuth client with Authorization Code + PKCE SHA-256.
- Use Expo development builds for OAuth and native module testing; do not use Expo Go as the acceptance environment.
- Use `npx expo install` for Expo-managed dependencies so versions match the selected SDK.
- Preserve the existing Next.js Command Centre and its current uncommitted changes.
- Mock mode must be feature-complete and honest about queued/local-only actions.
- Outlook-only events remain read-only.
- No background location tracking and no storage of exact GPS coordinates in job/worklog history.
- Timer elapsed time is derived from timestamps and survives suspension/restart.
- All behaviour changes follow test-first red-green-refactor cycles.

---

## Planned File Structure

```text
apps/technician-mobile/
  app/_layout.tsx
  app/index.tsx
  app/sign-in.tsx
  app/(tabs)/_layout.tsx
  app/(tabs)/today.tsx
  app/(tabs)/work.tsx
  app/(tabs)/sync.tsx
  app/(tabs)/profile.tsx
  app/job/[jobId].tsx
  src/api/client.ts
  src/auth/auth-session.ts
  src/auth/session-store.ts
  src/components/
  src/contracts/mobile.ts
  src/data/technician-repository.ts
  src/data/mock-technician-repository.ts
  src/data/api-technician-repository.ts
  src/data/offline-technician-repository.ts
  src/db/database.ts
  src/db/migrations.ts
  src/db/queries.ts
  src/features/evidence/
  src/features/jobs/
  src/features/parts/
  src/features/sign-off/
  src/features/sync/
  src/features/timer/
  src/features/worklogs/
  src/providers/app-providers.tsx
  src/theme/tokens.ts
  src/testing/fixtures.ts
  maestro/
  app.config.ts
  eas.json
  package.json
src/app/api/mobile/v1/
  auth/exchange/route.ts
  auth/refresh/route.ts
  auth/revoke/route.ts
  me/route.ts
  jobs/route.ts
  jobs/[jobId]/route.ts
  jobs/[jobId]/worklogs/route.ts
  jobs/[jobId]/status/route.ts
  jobs/[jobId]/timers/start/route.ts
  jobs/[jobId]/timers/[timerId]/stop/route.ts
  jobs/[jobId]/parts/route.ts
  jobs/[jobId]/sign-off/route.ts
  jobs/[jobId]/complete/route.ts
src/server/mobile-api/
  auth.ts
  contracts.ts
  responses.ts
  service.ts
```

## Task 1: Scaffold the Native Application Without Disturbing Web Command Centre

**Files:**
- Create: `apps/technician-mobile/**` using the current stable Expo Router TypeScript template
- Create: `apps/technician-mobile/app.config.ts`
- Create: `apps/technician-mobile/eas.json`
- Create: `apps/technician-mobile/.env.example`
- Modify: root workspace configuration only if required by pnpm
- Test: `apps/technician-mobile/src/testing/scaffold.test.ts`

**Interfaces:**
- Produces: runnable native project with scripts `start`, `ios`, `android`, `typecheck`, `lint`, and `test`
- Produces: public config keys `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_AUTH_MODE`

- [ ] **Step 1: Record the web baseline**

Run:

```bash
git status --short
corepack pnpm test
corepack pnpm lint
corepack pnpm build
```

Expected: capture the existing dirty files; all web checks pass before scaffolding.

- [ ] **Step 2: Scaffold with the current stable Expo Router template**

Run from repository root:

```bash
npx create-expo-app@latest apps/technician-mobile --template default
cd apps/technician-mobile
npx expo install expo-dev-client expo-router expo-secure-store expo-sqlite expo-auth-session expo-web-browser expo-linking
```

Record the resolved Expo SDK in `START-HERE.md`. Use the current stable default selected by `create-expo-app`; do not pin or downgrade to an older SDK solely to match this plan.

- [ ] **Step 3: Configure native identity**

Create `apps/technician-mobile/app.config.ts`:

```ts
import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Command Centre",
  slug: "egit-command-centre-technician",
  scheme: "egitcommand",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  ios: {
    bundleIdentifier: "au.com.egit.commandcentre",
    supportsTablet: false,
  },
  android: {
    package: "au.com.egit.commandcentre",
  },
  plugins: ["expo-router", "expo-secure-store", "expo-sqlite"],
  experiments: { typedRoutes: true },
};

export default config;
```

- [ ] **Step 4: Add deterministic scripts and fail-closed environment defaults**

Create `apps/technician-mobile/.env.example`:

```dotenv
EXPO_PUBLIC_API_BASE_URL=https://command.egit.com.au
EXPO_PUBLIC_AUTH_MODE=mock
EXPO_PUBLIC_ZOHO_CLIENT_ID=
```

No client secret is permitted.

- [ ] **Step 5: Verify native and web scaffolds**

Run:

```bash
cd apps/technician-mobile
npx expo-doctor
pnpm typecheck
pnpm lint
pnpm test
cd ../..
corepack pnpm test
corepack pnpm build
```

Expected: native checks pass; existing web checks remain green.

- [ ] **Step 6: Commit the scaffold**

```bash
git add apps/technician-mobile package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat: scaffold native technician app"
```

Only add root workspace files that actually changed.

## Task 2: Define Native Contracts and Deterministic Mock Data

**Files:**
- Create: `apps/technician-mobile/src/contracts/mobile.ts`
- Create: `apps/technician-mobile/src/data/technician-repository.ts`
- Create: `apps/technician-mobile/src/testing/fixtures.ts`
- Create: `apps/technician-mobile/src/data/mock-technician-repository.ts`
- Test: `apps/technician-mobile/src/data/mock-technician-repository.test.ts`

**Interfaces:**
- Produces: `MobileJob`, `MobileStaff`, `ActiveTimer`, `StoppedTimer`, `MutationReceipt`, `MutationEnvelope`
- Produces: `TechnicianRepository` used by every feature task

- [ ] **Step 1: Write failing repository tests**

```ts
it("returns only the signed-in technician schedule", async () => {
  const repository = new MockTechnicianRepository({ staffEmail: "riley@egit.com.au" });
  const jobs = await repository.listSchedule({ from: "2026-07-09", to: "2026-07-09" });
  expect(jobs.every((job) => job.technician.email === "riley@egit.com.au")).toBe(true);
});

it("keeps Outlook-only events read-only", async () => {
  const repository = new MockTechnicianRepository({ staffEmail: "riley@egit.com.au" });
  const job = await repository.getJob("outlook-block-riley");
  expect(job.permissions.canWriteWorklog).toBe(false);
  expect(job.source).toBe("outlook");
});
```

- [ ] **Step 2: Verify tests fail because contracts/repository do not exist**

Run: `pnpm test src/data/mock-technician-repository.test.ts`

Expected: FAIL on missing module or implementation.

- [ ] **Step 3: Define exact repository interface**

```ts
export interface TechnicianRepository {
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

- [ ] **Step 4: Implement deterministic fixtures and mock adapter**

Port domain meaning from `src/server/mobile/types.ts` and `src/server/mobile/services.ts`, but remove Next.js imports and browser-only assumptions. Use stable fixture IDs and fixed timestamps.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test src/data/mock-technician-repository.test.ts
git add apps/technician-mobile/src/contracts apps/technician-mobile/src/data apps/technician-mobile/src/testing
git commit -m "feat: add native technician contracts"
```

Expected: repository tests pass.

## Task 3: Build the Native App Shell, Theme, and Protected Navigation

**Files:**
- Create: `apps/technician-mobile/src/theme/tokens.ts`
- Create: `apps/technician-mobile/src/providers/app-providers.tsx`
- Create: `apps/technician-mobile/app/_layout.tsx`
- Create: `apps/technician-mobile/app/index.tsx`
- Create: `apps/technician-mobile/app/sign-in.tsx`
- Create: `apps/technician-mobile/app/(tabs)/_layout.tsx`
- Test: `apps/technician-mobile/app/navigation.test.tsx`

**Interfaces:**
- Consumes: `TechnicianRepository`
- Produces: `useTechnicianRepository()`, `useSession()`, protected Expo Router groups

- [ ] **Step 1: Write failing navigation tests**

```tsx
it("shows the native Zoho sign-in command when signed out", () => {
  renderRouter({ session: { status: "signed-out" } });
  expect(screen.getByRole("button", { name: "Sign in with Zoho" })).toBeOnTheScreen();
});

it("shows technician tabs when a mock session is approved", () => {
  renderRouter({ session: approvedRileySession });
  expect(screen.getByText("Today")).toBeOnTheScreen();
  expect(screen.getByText("My Work")).toBeOnTheScreen();
  expect(screen.getByText("Sync")).toBeOnTheScreen();
  expect(screen.getByText("Profile")).toBeOnTheScreen();
});
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test app/navigation.test.tsx`

Expected: FAIL because routes/providers are missing.

- [ ] **Step 3: Implement native theme tokens**

```ts
export const colours = {
  canvas: "#07111F",
  surface: "#0B1628",
  surfaceRaised: "#111D30",
  border: "#24364D",
  text: "#F8FAFC",
  muted: "#94A3B8",
  cyan: "#22D3EE",
  critical: "#F43F5E",
  high: "#F59E0B",
  medium: "#10B981",
  low: "#0EA5E9",
  outlook: "#64748B",
} as const;
```

- [ ] **Step 4: Implement protected navigation and native tab shell**

Use `Stack`, `Tabs`, `SafeAreaView`, system status bar styling, native headers, and icon buttons. Do not use HTML elements or CSS classes.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test app/navigation.test.tsx
git add apps/technician-mobile/app apps/technician-mobile/src/theme apps/technician-mobile/src/providers
git commit -m "feat: add native technician navigation"
```

## Task 4: Add SQLite Cache, Migrations, and Offline Mutation Queue

**Files:**
- Create: `apps/technician-mobile/src/db/migrations.ts`
- Create: `apps/technician-mobile/src/db/database.ts`
- Create: `apps/technician-mobile/src/db/queries.ts`
- Create: `apps/technician-mobile/src/features/sync/mutation-queue.ts`
- Test: `apps/technician-mobile/src/features/sync/mutation-queue.test.ts`

**Interfaces:**
- Produces: `openCommandCentreDatabase()`, `migrateDatabase()`, `enqueueMutation()`, `listRunnableMutations()`, `markMutationSynced()`, `markMutationFailed()`

- [ ] **Step 1: Write failing queue tests**

```ts
it("returns queued mutations in dependency and creation order", async () => {
  await queue.enqueue(worklogMutation({ id: "worklog-1" }));
  await queue.enqueue(completeMutation({ id: "complete-1", dependsOn: ["worklog-1"] }));
  expect((await queue.listRunnable()).map((item) => item.id)).toEqual(["worklog-1"]);
  await queue.markSynced("worklog-1");
  expect((await queue.listRunnable()).map((item) => item.id)).toEqual(["complete-1"]);
});

it("does not duplicate an existing idempotency key", async () => {
  await queue.enqueue(worklogMutation({ id: "same-key" }));
  await queue.enqueue(worklogMutation({ id: "same-key" }));
  expect(await queue.count()).toBe(1);
});
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test src/features/sync/mutation-queue.test.ts`

- [ ] **Step 3: Create schema version 1**

```sql
CREATE TABLE IF NOT EXISTS jobs_cache (
  id TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS active_timer (
  technician_id TEXT PRIMARY KEY NOT NULL,
  timer_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  started_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mutation_queue (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  depends_on_json TEXT NOT NULL,
  state TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL
);
```

Use parameterized queries for every user-derived value.

- [ ] **Step 4: Implement queue transitions and cache queries**

Allowed mutation states are `pending`, `syncing`, `failed`, and `synced`. A process restart must change abandoned `syncing` rows back to `pending` before processing.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test src/features/sync/mutation-queue.test.ts
git add apps/technician-mobile/src/db apps/technician-mobile/src/features/sync
git commit -m "feat: add native offline mutation queue"
```

## Task 5: Implement Today and My Work Screens

**Files:**
- Create: `apps/technician-mobile/app/(tabs)/today.tsx`
- Create: `apps/technician-mobile/app/(tabs)/work.tsx`
- Create: `apps/technician-mobile/src/features/jobs/job-card.tsx`
- Create: `apps/technician-mobile/src/features/jobs/use-schedule.ts`
- Test: `apps/technician-mobile/src/features/jobs/schedule-screens.test.tsx`

**Interfaces:**
- Consumes: `TechnicianRepository.listSchedule()`
- Produces: native `JobCard`, date navigation, workload sections, pull-to-refresh, cached-data state

- [ ] **Step 1: Write failing screen tests**

```tsx
it("shows only Riley's chronological jobs for the selected day", async () => {
  renderToday({ repository: rileyMockRepository, date: "2026-07-09" });
  expect(await screen.findByText("Firewall firmware window")).toBeOnTheScreen();
  expect(screen.queryByText("File server disk expansion")).not.toBeOnTheScreen();
});

it("labels Outlook-only events as read-only", async () => {
  renderToday({ repository: rileyMockRepository, date: "2026-07-09" });
  expect(await screen.findByText("Outlook Read Only")).toBeOnTheScreen();
});
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test src/features/jobs/schedule-screens.test.tsx`

- [ ] **Step 3: Implement touch-first cards and date controls**

Each card shows time, title, customer/site, priority, booking type, status, SLA warning, travel indicator, and queued/synced state. Use `FlatList`, `RefreshControl`, native press feedback, and stable keys.

- [ ] **Step 4: Implement workload sections and empty/offline states**

Sections: Today, Upcoming, Assigned to me, SLA risk, Waiting on me, Recently completed. Empty states describe the actual filter and never insert unrelated fallback jobs.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test src/features/jobs/schedule-screens.test.tsx
git add apps/technician-mobile/app/'(tabs)' apps/technician-mobile/src/features/jobs
git commit -m "feat: add native technician workload"
```

## Task 6: Implement Job Detail and Native Contact Actions

**Files:**
- Create: `apps/technician-mobile/app/job/[jobId].tsx`
- Create: `apps/technician-mobile/src/features/jobs/job-detail.tsx`
- Create: `apps/technician-mobile/src/features/jobs/native-actions.ts`
- Test: `apps/technician-mobile/src/features/jobs/job-detail.test.tsx`

**Interfaces:**
- Consumes: `TechnicianRepository.getJob()`
- Produces: job detail and `openPhone`, `openEmail`, `openMaps`, `openOutlookEvent`

- [ ] **Step 1: Write failing detail tests**

```tsx
it("disables write actions for Outlook-only events", async () => {
  renderJobDetail({ jobId: "outlook-block-riley" });
  expect(await screen.findByText("Outlook Read Only")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Start timer" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Complete job" })).toBeDisabled();
});

it("offers call and maps only when contact data exists", async () => {
  renderJobDetail({ jobId: "firewall-riley" });
  expect(await screen.findByRole("button", { name: "Call contact" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Open in Maps" })).toBeEnabled();
});
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test src/features/jobs/job-detail.test.tsx`

- [ ] **Step 3: Implement detail sections and permission-driven actions**

Render request number, title, priority, status, booking type, SLA, customer/site, contact, schedule, description, previous notes, travel, and sync state. Use native confirmation alerts for final actions.

- [ ] **Step 4: Implement linking helpers with validation**

Use `Linking.canOpenURL()` before opening `tel:`, `mailto:`, maps, or Outlook URLs. Do not generate a fake Outlook URL when the event does not provide one.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test src/features/jobs/job-detail.test.tsx
git add apps/technician-mobile/app/job apps/technician-mobile/src/features/jobs
git commit -m "feat: add native technician job detail"
```

## Task 7: Build the Persistent Native Timer and Worklog Summary

**Files:**
- Create: `apps/technician-mobile/src/features/timer/timer-service.ts`
- Create: `apps/technician-mobile/src/features/timer/timer-bar.tsx`
- Create: `apps/technician-mobile/src/features/timer/worklog-summary.tsx`
- Test: `apps/technician-mobile/src/features/timer/timer-service.test.ts`
- Test: `apps/technician-mobile/src/features/timer/timer-flow.test.tsx`

**Interfaces:**
- Produces: `startLocalTimer()`, `restoreActiveTimer()`, `elapsedSeconds()`, `stopLocalTimer()`, `roundWorklogMinutes()`

- [ ] **Step 1: Write failing timer unit tests**

```ts
it("restores elapsed time from timestamps after process suspension", async () => {
  await timer.start({ jobId: "job-1", technicianId: "tech-riley", now: at("09:00:00") });
  const restored = await timer.restore({ now: at("09:42:17") });
  expect(restored?.elapsedSeconds).toBe(2537);
});

it.each([[1, 15], [15, 15], [16, 30], [61, 75]])(
  "rounds %i minutes to %i",
  (actual, expected) => expect(roundWorklogMinutes(actual)).toBe(expected),
);
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test src/features/timer`

- [ ] **Step 3: Implement timestamp-derived timer persistence**

Store one `active_timer` SQLite row per technician. Foreground UI may update every second, but resume and restart always recalculate from `startedAt` and current time.

- [ ] **Step 4: Implement sticky timer bar and summary sheet**

The bar displays job title, `h:mm:ss` or `mm:ss`, and stop command. Stopping captures actual elapsed minutes, rounded worklog minutes, note type, note text, and optional status.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test src/features/timer
git add apps/technician-mobile/src/features/timer apps/technician-mobile/src/db
git commit -m "feat: add persistent native job timer"
```

## Task 8: Add Internal/External Notes, Status, and Completion

**Files:**
- Create: `apps/technician-mobile/src/features/worklogs/worklog-form.tsx`
- Create: `apps/technician-mobile/src/features/worklogs/worklog-service.ts`
- Create: `apps/technician-mobile/src/features/jobs/status-sheet.tsx`
- Create: `apps/technician-mobile/src/features/jobs/complete-job-sheet.tsx`
- Test: `apps/technician-mobile/src/features/worklogs/worklog-flow.test.tsx`

**Interfaces:**
- Consumes: queue and repository mutation commands
- Produces: `NoteVisibility = "internal" | "external"`, draft persistence, queued receipts

- [ ] **Step 1: Write failing note/completion tests**

```tsx
it("preserves an external note draft when submission fails", async () => {
  renderWorklog({ repository: failingRepository });
  await user.type(screen.getByLabelText("Work note"), "Replaced failed switch");
  await user.press(screen.getByLabelText("External note"));
  await user.press(screen.getByRole("button", { name: "Save worklog" }));
  expect(screen.getByDisplayValue("Replaced failed switch")).toBeOnTheScreen();
  expect(screen.getByText("Queued for retry")).toBeOnTheScreen();
});

it("requires a meaningful note before completion", async () => {
  renderCompletion({ job: jobWithoutNotes });
  await user.press(screen.getByRole("button", { name: "Complete job" }));
  expect(screen.getByText("Add a work note before completing this job.")).toBeOnTheScreen();
});
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test src/features/worklogs`

- [ ] **Step 3: Implement durable drafts and visibility model**

Draft key is `{technicianId}:{jobId}:worklog`. Internal/external visibility is explicit in both UI and queued payload; never infer visibility from worklog type.

- [ ] **Step 4: Implement status/completion rules**

Statuses: Scheduled, In Progress, Waiting on Customer, Waiting on Parts, Needs Follow-up, Completed, Cancelled / No Access. Outlook-only jobs reject every write path at both UI and repository layers.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test src/features/worklogs src/features/jobs
git add apps/technician-mobile/src/features/worklogs apps/technician-mobile/src/features/jobs
git commit -m "feat: add native worklogs and completion"
```

## Task 9: Add Native Evidence Capture and Retry-Safe Upload Staging

**Files:**
- Create: `apps/technician-mobile/src/features/evidence/evidence-picker.ts`
- Create: `apps/technician-mobile/src/features/evidence/evidence-list.tsx`
- Create: `apps/technician-mobile/src/features/evidence/evidence-service.ts`
- Modify: `apps/technician-mobile/app.config.ts`
- Test: `apps/technician-mobile/src/features/evidence/evidence-service.test.ts`

**Interfaces:**
- Produces: `stageEvidence()`, `markEvidenceUploaded()`, `removeLocalEvidenceAfterSync()`

- [ ] **Step 1: Write failing evidence tests**

```ts
it("retains a local file URI when upload fails", async () => {
  const item = await evidence.stage({ jobId: "job-1", localUri: "file:///photo.jpg", kind: "photo" });
  await evidence.markFailed(item.id, "network");
  expect(await evidence.get(item.id)).toMatchObject({ localUri: "file:///photo.jpg", state: "failed" });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test src/features/evidence/evidence-service.test.ts`

- [ ] **Step 3: Install and configure native pickers**

```bash
npx expo install expo-camera expo-image-picker expo-document-picker expo-file-system
```

Add precise camera and photo usage descriptions. Request permissions only when the relevant command is tapped.

- [ ] **Step 4: Implement staging, progress, retry, and cleanup**

Files remain local while `pending`, `uploading`, or `failed`. Delete the staged local copy only after server acknowledgement and a recorded synced receipt.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test src/features/evidence
git add apps/technician-mobile/src/features/evidence apps/technician-mobile/app.config.ts apps/technician-mobile/package.json
git commit -m "feat: add native job evidence capture"
```

## Task 10: Add Parts Used and Customer Sign-off

**Files:**
- Create: `apps/technician-mobile/src/features/parts/parts-form.tsx`
- Create: `apps/technician-mobile/src/features/parts/parts-service.ts`
- Create: `apps/technician-mobile/src/features/sign-off/signature-pad.tsx`
- Create: `apps/technician-mobile/src/features/sign-off/signature-file.ts`
- Create: `apps/technician-mobile/src/features/sign-off/sign-off-form.tsx`
- Test: `apps/technician-mobile/src/features/parts/parts-flow.test.tsx`
- Test: `apps/technician-mobile/src/features/sign-off/sign-off-flow.test.tsx`

**Interfaces:**
- Produces: queued `AddPartCommand` and `SaveSignOffCommand`

- [ ] **Step 1: Write failing validation tests**

```tsx
it("rejects zero part quantity", async () => {
  renderPartsForm();
  await user.type(screen.getByLabelText("Part name"), "Patch lead");
  await user.clear(screen.getByLabelText("Quantity"));
  await user.type(screen.getByLabelText("Quantity"), "0");
  await user.press(screen.getByRole("button", { name: "Add part" }));
  expect(screen.getByText("Quantity must be at least 1.")).toBeOnTheScreen();
});

it("requires customer acceptance and a signature", async () => {
  renderSignOff();
  await user.press(screen.getByRole("button", { name: "Save sign-off" }));
  expect(screen.getByText("Customer acceptance and signature are required.")).toBeOnTheScreen();
});
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test src/features/parts src/features/sign-off`

- [ ] **Step 3: Implement parts form and queue payload**

Fields: part name, optional SKU, quantity, optional note. UI says `Queued` until acknowledged; it never claims inventory was adjusted.

- [ ] **Step 4: Implement drawn signature capture**

Install `@shopify/react-native-skia` with `npx expo install` and use its native `Canvas`/`Path` primitives with React Native gesture input. Keep the captured stroke points in component state, provide Clear and Undo controls, render the final signature to a transparent PNG in app storage, and attach that file URI to `SaveSignOffCommand`. Never place signature base64 or stroke data in application logs. Verify Skia compatibility against the resolved Expo SDK before committing.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test src/features/parts src/features/sign-off
git add apps/technician-mobile/src/features/parts apps/technician-mobile/src/features/sign-off apps/technician-mobile/package.json
git commit -m "feat: add parts and customer sign-off"
```

## Task 11: Add On-Demand ETA and Maps Handoff

**Files:**
- Create: `apps/technician-mobile/src/features/jobs/eta-service.ts`
- Create: `apps/technician-mobile/src/features/jobs/eta-panel.tsx`
- Modify: `apps/technician-mobile/app.config.ts`
- Test: `apps/technician-mobile/src/features/jobs/eta-service.test.ts`

**Interfaces:**
- Produces: `calculateOnDemandEta()`, `openPreferredMaps()`

- [ ] **Step 1: Write failing privacy tests**

```ts
it("requests a single foreground position only after Calculate ETA", async () => {
  const location = fakeLocationProvider();
  const service = createEtaService({ location });
  expect(location.getCurrentPosition).not.toHaveBeenCalled();
  await service.calculate(destination);
  expect(location.getCurrentPosition).toHaveBeenCalledTimes(1);
  expect(location.watchPosition).not.toHaveBeenCalled();
});

it("does not include coordinates in persisted ETA output", async () => {
  const result = await service.calculate(destination);
  expect(JSON.stringify(result.persisted)).not.toContain("-37.825");
});
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test src/features/jobs/eta-service.test.ts`

- [ ] **Step 3: Install foreground location support**

Run: `npx expo install expo-location`

Configure location-when-in-use text only. Do not add background location modes.

- [ ] **Step 4: Implement ETA and denial fallback**

Use a one-shot foreground location to calculate/display ETA. Persist only non-sensitive summary such as calculated time and timestamp. Always retain maps handoff when permission is denied.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test src/features/jobs/eta-service.test.ts
git add apps/technician-mobile/src/features/jobs apps/technician-mobile/app.config.ts apps/technician-mobile/package.json
git commit -m "feat: add privacy-safe native ETA"
```

## Task 12: Implement API Client, Offline Repository, and Sync Screen

**Files:**
- Create: `apps/technician-mobile/src/api/client.ts`
- Create: `apps/technician-mobile/src/data/api-technician-repository.ts`
- Create: `apps/technician-mobile/src/data/offline-technician-repository.ts`
- Create: `apps/technician-mobile/app/(tabs)/sync.tsx`
- Test: `apps/technician-mobile/src/data/offline-technician-repository.test.ts`

**Interfaces:**
- Consumes: repository contract and mutation queue
- Produces: authenticated API adapter, cache-first reads, ordered retries, sync diagnostics

- [ ] **Step 1: Write failing offline tests**

```ts
it("returns cached jobs when the network is unavailable", async () => {
  await cache.replaceJobs([firewallJob]);
  const repository = offlineRepository({ remote: offlineApi, cache });
  expect(await repository.listSchedule(dayRange)).toEqual([firewallJob]);
});

it("sends an idempotency key and marks one successful receipt", async () => {
  await queue.enqueue(saveNoteMutation({ id: "note-123" }));
  await sync.run();
  expect(api.calls[0].headers["Idempotency-Key"]).toBe("note-123");
  expect((await queue.get("note-123"))?.state).toBe("synced");
});
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test src/data/offline-technician-repository.test.ts`

- [ ] **Step 3: Implement safe API client**

The client adds `Authorization: Bearer <Command Centre token>`, `Accept: application/json`, request ID, and idempotency key where required. Redact tokens and evidence URLs from logs.

- [ ] **Step 4: Implement cache-first reads and mutation processing**

Foreground/resume/network-reconnect may trigger sync. No background task is required for V1. Display exact states: Cached, Pending, Syncing, Failed, Synced.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test src/data/offline-technician-repository.test.ts
git add apps/technician-mobile/src/api apps/technician-mobile/src/data apps/technician-mobile/app/'(tabs)'/sync.tsx
git commit -m "feat: add native offline sync adapter"
```

## Task 13: Add Native Zoho PKCE and Command Centre Mobile Sessions

**Files:**
- Create: `apps/technician-mobile/src/auth/auth-session.ts`
- Create: `apps/technician-mobile/src/auth/session-store.ts`
- Modify: `apps/technician-mobile/app/sign-in.tsx`
- Create: `src/server/mobile-api/auth.ts`
- Create: `src/app/api/mobile/v1/auth/exchange/route.ts`
- Create: `src/app/api/mobile/v1/auth/refresh/route.ts`
- Create: `src/app/api/mobile/v1/auth/revoke/route.ts`
- Test: `apps/technician-mobile/src/auth/auth-session.test.ts`
- Test: `src/server/mobile-api/auth.test.ts`

**Interfaces:**
- Produces: `beginZohoLogin()`, `exchangeZohoCode()`, `restoreMobileSession()`, `refreshMobileSession()`, `revokeMobileSession()`

- [ ] **Step 1: Write failing auth tests**

```ts
it("uses authorization code with PKCE S256 and no client secret", () => {
  const request = buildZohoAuthorizationRequest(nativeConfig);
  expect(request.responseType).toBe("code");
  expect(request.codeChallengeMethod).toBe("S256");
  expect(JSON.stringify(request)).not.toContain("client_secret");
});

it("rejects an authenticated Zoho email outside the allowlist", async () => {
  const result = await exchangeMobileLogin(fakeZohoCode("outside@example.com"));
  expect(result).toEqual({ status: "not-approved", email: "outside@example.com" });
});
```

- [ ] **Step 2: Verify tests fail**

Run:

```bash
cd apps/technician-mobile && pnpm test src/auth/auth-session.test.ts
cd ../.. && corepack pnpm test src/server/mobile-api/auth.test.ts
```

- [ ] **Step 3: Implement native PKCE request**

Use `AuthSession.makeRedirectUri({ scheme: "egitcommand", path: "auth/callback" })`, `ResponseType.Code`, PKCE enabled, exact Zoho Australia endpoints, state validation, and a user-triggered system-browser prompt. Development builds are mandatory.

- [ ] **Step 4: Implement server exchange and Command Centre session**

`POST /api/mobile/v1/auth/exchange` accepts `{ code, codeVerifier, redirectUri }`, exchanges with Zoho server-side, retrieves email, applies the existing allowlist/staff-profile rules, discards provider tokens, and issues short-lived access plus rotating revocable renewal material. Fail closed when native OAuth/session signing env values are missing.

- [ ] **Step 5: Store only Command Centre session material in SecureStore**

Use one namespaced SecureStore record. Clear it after revoke or irrecoverable refresh failure. Never persist the PKCE verifier after the exchange finishes.

- [ ] **Step 6: Run tests and commit**

```bash
cd apps/technician-mobile && pnpm test src/auth
cd ../.. && corepack pnpm test src/server/mobile-api/auth.test.ts
git add apps/technician-mobile/src/auth apps/technician-mobile/app/sign-in.tsx src/server/mobile-api src/app/api/mobile/v1/auth
git commit -m "feat: add native Zoho mobile sessions"
```

## Task 14: Add Versioned Command Centre Mobile API Routes

**Files:**
- Create: `src/server/mobile-api/contracts.ts`
- Create: `src/server/mobile-api/responses.ts`
- Create: `src/server/mobile-api/service.ts`
- Create: route handlers under `src/app/api/mobile/v1/me` and `jobs`
- Test: `src/server/mobile-api/service.test.ts`
- Test: route tests beside each route group

**Interfaces:**
- Consumes: existing mobile services/mock data and mobile session authorization
- Produces: versioned JSON DTOs and mutation receipts matching native contracts

- [ ] **Step 1: Write failing authorization and DTO tests**

```ts
it("returns only jobs for the authenticated staff profile", async () => {
  const response = await listMobileJobs({ auth: rileyMobileAuth, from: "2026-07-09", to: "2026-07-09" });
  expect(response.jobs.every((job) => job.technician.email === "riley@egit.com.au")).toBe(true);
});

it("rejects a write to an Outlook-only event", async () => {
  await expect(saveMobileWorklog({ auth: rileyMobileAuth, jobId: "outlook-block-riley", command })).rejects.toMatchObject({ status: 409 });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `corepack pnpm test src/server/mobile-api`

- [ ] **Step 3: Implement shared response format**

```ts
export type MobileApiSuccess<T> = { ok: true; data: T; requestId: string };
export type MobileApiFailure = {
  ok: false;
  error: { code: string; message: string; retryable: boolean };
  requestId: string;
};
```

- [ ] **Step 4: Implement mock-backed truthful routes**

Reads may use existing mock services. Mutations return a receipt with `mode: "mock"` and never claim MSP Central or Outlook writeback. Live integrations remain server-side and fail closed until configured.

- [ ] **Step 5: Run server and web regression checks**

```bash
corepack pnpm test src/server/mobile-api src/app/api/mobile/v1
corepack pnpm lint
corepack pnpm build
```

- [ ] **Step 6: Commit API boundary**

```bash
git add src/server/mobile-api src/app/api/mobile/v1
git commit -m "feat: add Command Centre mobile API"
```

## Task 15: Add Push Registration Foundation and Native Diagnostics

**Files:**
- Create: `apps/technician-mobile/src/features/notifications/register-device.ts`
- Create: `apps/technician-mobile/app/(tabs)/profile.tsx`
- Create: `src/app/api/mobile/v1/devices/push-token/route.ts`
- Test: `apps/technician-mobile/src/features/notifications/register-device.test.ts`

**Interfaces:**
- Produces: opt-in permission request, token registration, safe profile diagnostics

- [ ] **Step 1: Write failing permission-timing test**

```ts
it("does not request notification permission before the user opts in", async () => {
  renderProfile();
  expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  await user.press(screen.getByRole("button", { name: "Enable job notifications" }));
  expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm test src/features/notifications/register-device.test.ts`

- [ ] **Step 3: Install and configure notifications**

Run: `npx expo install expo-notifications expo-device expo-constants`

Register only after explicit opt-in. Store tokens server-side per staff/device; never log full push tokens.

- [ ] **Step 4: Implement Profile diagnostics**

Show signed-in staff, app version, API mode, last sync, pending count, build channel, notification status, privacy-safe device label, and sign-out. Do not expose secrets or raw tokens.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test src/features/notifications
git add apps/technician-mobile/src/features/notifications apps/technician-mobile/app/'(tabs)'/profile.tsx apps/technician-mobile/app.config.ts src/app/api/mobile/v1/devices
git commit -m "feat: add technician notification foundation"
```

## Task 16: Configure EAS Builds and Cross-Platform End-to-End Verification

**Files:**
- Modify: `apps/technician-mobile/eas.json`
- Create: `apps/technician-mobile/maestro/sign-in-mock.yaml`
- Create: `apps/technician-mobile/maestro/timer-restart.yaml`
- Create: `apps/technician-mobile/maestro/offline-note.yaml`
- Create: `apps/technician-mobile/maestro/outlook-read-only.yaml`
- Create: `apps/technician-mobile/README.md`

**Interfaces:**
- Produces: development, preview/internal, and production profiles; repeatable iOS/Android smoke flows

- [ ] **Step 1: Configure build profiles**

```json
{
  "cli": { "appVersionSource": "remote" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview": { "distribution": "internal", "channel": "preview" },
    "production": { "autoIncrement": true, "channel": "production" }
  }
}
```

- [ ] **Step 2: Add Maestro flows with stable accessibility IDs**

Each flow launches clean, uses mock auth where specified, and asserts visible outcomes rather than coordinates. The timer flow backgrounds/relaunches and verifies restored elapsed state.

- [ ] **Step 3: Run complete native quality gate**

```bash
cd apps/technician-mobile
npx expo-doctor
pnpm typecheck
pnpm lint
pnpm test
npx expo export --platform ios
npx expo export --platform android
```

Expected: all commands exit zero.

- [ ] **Step 4: Run simulators and Maestro**

```bash
npx expo run:ios
npx expo run:android
maestro test maestro/sign-in-mock.yaml
maestro test maestro/timer-restart.yaml
maestro test maestro/offline-note.yaml
maestro test maestro/outlook-read-only.yaml
```

Expected: both apps launch and all four flows pass on both available platforms.

- [ ] **Step 5: Build installable previews**

```bash
eas build --platform ios --profile preview
eas build --platform android --profile preview
```

If Apple/Google/Expo credentials are unavailable, stop at the credential prompt, record the exact missing access, and retain successful local simulator verification.

- [ ] **Step 6: Run web regression gate**

```bash
cd ../..
corepack pnpm test
corepack pnpm lint
corepack pnpm build
```

Expected: existing Command Centre remains green.

- [ ] **Step 7: Commit release configuration**

```bash
git add apps/technician-mobile/eas.json apps/technician-mobile/maestro apps/technician-mobile/README.md
git commit -m "test: verify native technician app"
```

## Final Review Checklist

- [ ] No WebView, iframe, Capacitor, or PWA wrapper exists.
- [ ] Technician-only navigation contains Today, My Work, Sync, and Profile.
- [ ] App never contains a confidential OAuth/service secret.
- [ ] Zoho uses native PKCE and Command Centre-owned sessions.
- [ ] Only authenticated staff jobs are returned.
- [ ] Outlook-only events reject writes in UI, repository, and server routes.
- [ ] Timer survives app suspension/restart and cannot double-start.
- [ ] Notes distinguish internal and external visibility.
- [ ] Failed notes/evidence/parts/sign-off remain queued and inspectable.
- [ ] Exact GPS is neither stored nor background-tracked.
- [ ] Native camera, files, maps, phone, email, and signature flows work.
- [ ] iOS and Android accessibility, safe areas, keyboard, and back navigation are verified.
- [ ] Native quality gate and Maestro flows pass.
- [ ] Existing web tests, lint, and production build pass.
- [ ] Preview distribution is completed or blocked only by explicitly recorded external credentials.

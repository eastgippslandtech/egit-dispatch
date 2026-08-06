# Wallboard Local Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent username/password login for the wallboard PC that can read `/wallboard` and its live presence feed but cannot access Dispatch or any write/integration endpoint.

**Architecture:** Auth.js remains the only browser session system. A dedicated credentials provider verifies one environment-backed `scrypt` password, stores `accessLevel: "wallboard"` in the signed JWT, and uses a Postgres-backed failed-attempt limiter. Existing Zoho sessions become explicit `staff` sessions, while separate server access helpers enforce staff-only and wallboard-readable boundaries.

**Tech Stack:** Next.js 16 App Router, Auth.js 5, TypeScript, Node `crypto`, Postgres.js, Supabase migrations, Vitest, Testing Library, Vercel.

## Global Constraints

- Zoho remains the only staff login and existing approved staff keep access to Dispatch and Wallboard.
- The local account may access `/wallboard` and `GET /api/internal/presence` only.
- The local account may not access `/dispatch`, presence writes, Graph, MSP Central, scheduling, identity, readiness, or mobile endpoints.
- No public signup, reset, account-management, or local staff login is added.
- Store only `WALLBOARD_LOCAL_USERNAME` and `WALLBOARD_LOCAL_PASSWORD_HASH` in protected server environment variables.
- Persist the signed wallboard session for 30 days.
- Block after five failures for the same normalized username and client address within 15 minutes, for 15 minutes.
- Never store a raw password or client address.
- Preserve the locked Command Centre and Wallboard visual direction.

---

## File Structure

- `src/server/auth/wallboard-password.ts`: parse, create, and verify versioned `scrypt` password hashes.
- `src/server/auth/wallboard-login-attempts.ts`: Postgres-backed failed-login persistence and rate-limit repository.
- `src/server/auth/wallboard-login.ts`: normalize credentials, derive an HMAC attempt key, enforce throttling, and authenticate the local account.
- `src/server/auth/wallboard-provider.ts`: create the Auth.js credentials provider and extract the trusted client address.
- `src/types/next-auth.d.ts`: augment Auth.js JWT/session types with `accessLevel`.
- `src/server/auth/session.ts`: expose explicit staff-only and wallboard-readable access decisions.
- `src/app/auth/wallboard-sign-in/actions.ts`: server action that invokes the credentials provider and maps failures to generic UI state.
- `src/app/auth/wallboard-sign-in/page.tsx`: wallboard-only branded sign-in page.
- `src/app/wallboard/protected-screen.tsx`: accept approved staff or wallboard sessions and pass capability flags to the UI.
- `src/app/wallboard/wallboard-screen.tsx`: hide Dispatch navigation for wallboard-only sessions and sign out back to the local login page.
- `src/app/api/internal/presence/route.ts`: allow wallboard access to GET while keeping POST staff-only.
- `supabase/migrations/20260727*_wallboard_login_attempts.sql`: durable failed-attempt table with RLS and service-role access.
- `.env.example`, `README.md`: document setup without real credentials.

---

### Task 1: Password Hashing And Durable Login Throttling

**Files:**
- Create: `src/server/auth/wallboard-password.test.ts`
- Create: `src/server/auth/wallboard-password.ts`
- Create: `src/server/auth/wallboard-login-attempts.test.ts`
- Create: `src/server/auth/wallboard-login-attempts.ts`
- Create: `supabase/migrations/20260727090000_wallboard_login_attempts.sql`

**Interfaces:**
- Produces: `hashWallboardPassword(password: string): Promise<string>`
- Produces: `verifyWallboardPassword(password: string, encodedHash: string): Promise<boolean>`
- Produces: `WallboardLoginAttemptStore`
- Produces: `createWallboardLoginAttemptRepository(store)`
- Produces: `createPostgresWallboardLoginAttemptRepository({ databaseUrl, sql? })`

- [ ] **Step 1: Write failing password-hash tests**

```ts
import { describe, expect, it } from "vitest";
import {
  hashWallboardPassword,
  verifyWallboardPassword,
} from "./wallboard-password";

describe("wallboard password hashing", () => {
  it("round-trips a valid password through a salted scrypt hash", async () => {
    const encoded = await hashWallboardPassword("Correct Horse 42!");
    await expect(
      verifyWallboardPassword("Correct Horse 42!", encoded),
    ).resolves.toBe(true);
    await expect(
      verifyWallboardPassword("wrong", encoded),
    ).resolves.toBe(false);
    expect(encoded).toMatch(/^scrypt\$1\$/);
    expect(encoded).not.toContain("Correct Horse 42!");
  });

  it("rejects malformed hashes without throwing", async () => {
    await expect(
      verifyWallboardPassword("anything", "not-a-hash"),
    ).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run the password tests and verify RED**

Run: `pnpm test src/server/auth/wallboard-password.test.ts`

Expected: FAIL because `wallboard-password.ts` does not exist.

- [ ] **Step 3: Implement versioned `scrypt` hashing**

Use `node:crypto` `randomBytes`, `scrypt`, and `timingSafeEqual`. Encode:

```text
scrypt$1$16384$8$1$<base64url-salt>$<base64url-derived-key>
```

Use a 16-byte salt, 32-byte key, `N=16384`, `r=8`, `p=1`, and return `false`
for malformed versions, numbers, salt, or derived keys.

- [ ] **Step 4: Run the password tests and verify GREEN**

Run: `pnpm test src/server/auth/wallboard-password.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing login-attempt repository tests**

Define a memory store and verify:

```ts
const repository = createWallboardLoginAttemptRepository(memoryStore());
const now = new Date("2026-07-27T00:15:00.000Z");

expect(await repository.isBlocked("attempt-key", now)).toBe(false);
for (let index = 0; index < 5; index += 1) {
  await repository.recordFailure("attempt-key", now);
}
expect(await repository.isBlocked("attempt-key", now)).toBe(true);
await repository.clear("attempt-key");
expect(await repository.isBlocked("attempt-key", now)).toBe(false);
```

Add a boundary test proving failures older than 15 minutes do not count.

- [ ] **Step 6: Run the repository tests and verify RED**

Run: `pnpm test src/server/auth/wallboard-login-attempts.test.ts`

Expected: FAIL because the repository module does not exist.

- [ ] **Step 7: Implement repository and migration**

The migration creates:

```sql
create table if not exists public.wallboard_login_attempts (
  id bigint generated by default as identity primary key,
  attempt_key text not null,
  failed_at timestamptz not null default now()
);

create index if not exists wallboard_login_attempts_key_time_idx
  on public.wallboard_login_attempts (attempt_key, failed_at desc);

alter table public.wallboard_login_attempts enable row level security;
revoke all on public.wallboard_login_attempts from anon, authenticated;
grant select, insert, delete on public.wallboard_login_attempts to service_role;
```

The repository uses exactly five failures and a 15-minute rolling window.
`clear` deletes the key, `recordFailure` inserts one row, `isBlocked` counts
recent rows, and each check deletes records older than 24 hours.

- [ ] **Step 8: Run Task 1 tests and commit**

Run:

```powershell
pnpm test src/server/auth/wallboard-password.test.ts src/server/auth/wallboard-login-attempts.test.ts
git add src/server/auth/wallboard-password.* src/server/auth/wallboard-login-attempts.* supabase/migrations/20260727090000_wallboard_login_attempts.sql
git commit -m "feat: add secure wallboard credential storage"
```

Expected: tests PASS and commit succeeds.

---

### Task 2: Wallboard Credential Service And Auth.js Session Role

**Files:**
- Create: `src/server/auth/wallboard-login.test.ts`
- Create: `src/server/auth/wallboard-login.ts`
- Create: `src/server/auth/wallboard-provider.test.ts`
- Create: `src/server/auth/wallboard-provider.ts`
- Create: `src/types/next-auth.d.ts`
- Modify: `src/auth.ts`

**Interfaces:**
- Consumes: `verifyWallboardPassword`
- Consumes: `createPostgresWallboardLoginAttemptRepository`
- Produces: `authenticateWallboardLogin(input, dependencies?)`
- Produces: `isWallboardLoginConfigured(env?)`
- Produces: `createWallboardProvider()`
- Produces: `Session.accessLevel: "staff" | "wallboard"`

- [ ] **Step 1: Write failing credential-service tests**

Test real service behavior with a memory attempt repository:

```ts
const result = await authenticateWallboardLogin(
  {
    clientAddress: "203.0.113.4",
    password: "Display-only 42!",
    username: " WALLBOARD ",
  },
  {
    attemptRepository,
    env: {
      AUTH_SECRET: "test-auth-secret",
      DATABASE_URL: "postgresql://example",
      WALLBOARD_LOCAL_PASSWORD_HASH: await hashWallboardPassword(
        "Display-only 42!",
      ),
      WALLBOARD_LOCAL_USERNAME: "wallboard",
    },
    now: () => new Date("2026-07-27T00:15:00.000Z"),
  },
);

expect(result).toEqual({
  id: "wallboard-local",
  name: "Command Centre Wallboard",
});
```

Add tests for wrong credentials, missing configuration, five failed attempts,
successful clearing, and proving the stored attempt key contains neither the
raw username nor client address.

- [ ] **Step 2: Run the credential-service tests and verify RED**

Run: `pnpm test src/server/auth/wallboard-login.test.ts`

Expected: FAIL because the login service does not exist.

- [ ] **Step 3: Implement the credential service**

Normalize usernames with `trim().toLowerCase()`. Derive:

```ts
createHmac("sha256", authSecret)
  .update(`${normalizedUsername}\0${clientAddress}`)
  .digest("base64url");
```

Always verify the password hash before returning an invalid result. Return the
fixed local user only when both username and password match. Use the repository
to reject blocked keys, record failures, and clear successful attempts.

- [ ] **Step 4: Run service tests and verify GREEN**

Run: `pnpm test src/server/auth/wallboard-login.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing provider and session callback tests**

Verify the provider:

- has id `wallboard`
- accepts `username` and `password`
- reads `x-vercel-forwarded-for` before `x-forwarded-for`
- returns the fixed local user only through `authenticateWallboardLogin`

Extract Auth.js callback functions from `src/auth.ts` into exported constants
for direct tests. Verify:

```ts
expect(
  await authCallbacks.jwt({
    account: { provider: "wallboard" },
    token: {},
    user: { id: "wallboard-local" },
  } as never),
).toMatchObject({ accessLevel: "wallboard" });

expect(
  await authCallbacks.jwt({
    account: { provider: "zoho" },
    token: { email: "simeon@egit.com.au" },
  } as never),
).toMatchObject({ accessLevel: "staff" });
```

Also verify an existing Zoho JWT with an email but no role is upgraded to
`staff`.

- [ ] **Step 6: Run provider tests and verify RED**

Run: `pnpm test src/server/auth/wallboard-provider.test.ts`

Expected: FAIL because the provider and callbacks are not wired.

- [ ] **Step 7: Wire Auth.js provider and role callbacks**

Register `createWallboardProvider()` after Zoho. Configure:

```ts
session: { maxAge: 30 * 24 * 60 * 60, strategy: "jwt" }
```

The JWT callback sets `wallboard` only for provider `wallboard`, `staff` for
provider `zoho`, and defaults existing email-bearing tokens to `staff`. The
session callback copies only the signed token role onto `session.accessLevel`.

- [ ] **Step 8: Run Task 2 tests and commit**

Run:

```powershell
pnpm test src/server/auth/wallboard-login.test.ts src/server/auth/wallboard-provider.test.ts
git add src/auth.ts src/types/next-auth.d.ts src/server/auth/wallboard-login.* src/server/auth/wallboard-provider.*
git commit -m "feat: add wallboard-only Auth.js session"
```

Expected: tests PASS and commit succeeds.

---

### Task 3: Explicit Staff And Wallboard Authorization Boundaries

**Files:**
- Modify: `src/server/auth/session.ts`
- Modify: `src/server/auth/session.test.ts`
- Modify: `src/app/dispatch/command-centre/protected-screen.tsx`
- Modify: `src/app/dispatch/command-centre/page.test.tsx`
- Modify: `src/app/wallboard/protected-screen.tsx`
- Modify: `src/app/wallboard/page.test.tsx`
- Modify: every `src/app/api/internal/**/route.ts` that calls `getCommandCentreAccess`
- Modify: corresponding route tests
- Modify: `src/app/mobile/page.tsx`
- Modify: `src/app/mobile/page.test.tsx`

**Interfaces:**
- Produces: `getCommandCentreAccess()` for staff-only access
- Produces: `getWallboardAccess()` for approved staff or wallboard access
- Produces: `isApprovedStaffAccess(access)` type guard
- Produces: access status `"wallboard-only"` for an authenticated restricted session

- [ ] **Step 1: Write failing session-access tests**

Add a minimal session with `accessLevel: "wallboard"` and verify:

```ts
expect(commandCentreAccessFromSession(wallboardSession, env)).toEqual({
  name: "Command Centre Wallboard",
  status: "wallboard-only",
});

expect(wallboardAccessFromSession(wallboardSession, env)).toEqual({
  accessLevel: "wallboard",
  name: "Command Centre Wallboard",
  status: "approved",
});
```

Verify allowlisted Zoho sessions receive approved `staff` wallboard access and
non-allowlisted Zoho users remain blocked.

- [ ] **Step 2: Run session tests and verify RED**

Run: `pnpm test src/server/auth/session.test.ts`

Expected: FAIL because wallboard access is not represented.

- [ ] **Step 3: Implement explicit access helpers**

Extend the minimal session with `accessLevel`. `getWallboardAccess` must call
the same Auth.js `auth()` function but accept a signed wallboard role.
`getCommandCentreAccess` must never return `approved` for that role.

- [ ] **Step 4: Run session tests and verify GREEN**

Run: `pnpm test src/server/auth/session.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing page and API authorization tests**

Add tests proving:

- `/wallboard` renders for `accessLevel: "wallboard"`
- `/dispatch` redirects a `wallboard-only` status to `/wallboard`
- `GET /api/internal/presence` returns 200 for a wallboard session
- `POST /api/internal/presence` returns 403 for a wallboard session
- every other internal route returns 403 for `wallboard-only`
- the legacy web mobile page redirects wallboard-only access to `/wallboard`

- [ ] **Step 6: Run the focused page/API tests and verify RED**

Run:

```powershell
pnpm test src/app/wallboard/page.test.tsx src/app/dispatch/command-centre/page.test.tsx src/app/api/internal/presence/route.test.ts
```

Expected: FAIL because the current gates treat every approved session alike.

- [ ] **Step 7: Apply the least-privilege route gates**

Use `getWallboardAccess` only in the wallboard page and presence GET. Use
`isApprovedStaffAccess` everywhere else. Return 401 for unauthenticated and 403
for wallboard-only or non-approved sessions. Do not add wallboard access to any
Graph, MSP Central, dispatch write, identity, readiness, mobile, or presence
POST path.

Run:

```powershell
rg -n "getCommandCentreAccess" src/app src/server
```

Review every result and confirm no caller treats `wallboard-only` as approved.

- [ ] **Step 8: Run authorization tests and commit**

Run:

```powershell
pnpm test src/server/auth/session.test.ts src/app/wallboard/page.test.tsx src/app/dispatch/command-centre/page.test.tsx src/app/api/internal
git add src/server/auth/session.* src/app/dispatch src/app/wallboard src/app/api/internal src/app/mobile
git commit -m "fix: enforce wallboard read-only access"
```

Expected: tests PASS and commit succeeds.

---

### Task 4: Branded Wallboard Sign-In Experience

**Files:**
- Create: `src/app/auth/wallboard-sign-in/actions.test.ts`
- Create: `src/app/auth/wallboard-sign-in/actions.ts`
- Create: `src/app/auth/wallboard-sign-in/page.test.tsx`
- Create: `src/app/auth/wallboard-sign-in/page.tsx`
- Modify: `src/app/wallboard/protected-screen.tsx`
- Modify: `src/app/wallboard/wallboard-screen.tsx`
- Modify: `src/app/wallboard/page.test.tsx`

**Interfaces:**
- Consumes: provider id `wallboard`
- Consumes: `isWallboardLoginConfigured`
- Produces: `wallboardSignIn(formData: FormData)`
- Produces: `WallboardScreen({ canAccessDispatch, ... })`

- [ ] **Step 1: Write failing sign-in action tests**

Mock `signIn` and verify the action passes only normalized username, password,
provider `wallboard`, and `redirectTo: "/wallboard"`. Verify Auth.js credential
errors redirect to:

```text
/auth/wallboard-sign-in?error=invalid
```

Do not place raw credentials in redirects or logs.

- [ ] **Step 2: Run action tests and verify RED**

Run: `pnpm test src/app/auth/wallboard-sign-in/actions.test.ts`

Expected: FAIL because the action does not exist.

- [ ] **Step 3: Implement the server action**

Catch only Auth.js credential errors and map all of them to the same generic
error query. Re-throw unexpected errors. The action must import server
`signIn` from `@/auth`, never use a client-side credential fetch.

- [ ] **Step 4: Write failing sign-in page tests**

Verify:

- heading `Wallboard sign in`
- username and password inputs
- `Sign in to Wallboard` submit button
- `Staff sign in with Zoho` link to `/auth/sign-in`
- generic `Sign-in details were not accepted.` error
- configuration unavailable copy when required env is missing
- no signup or password-reset copy

- [ ] **Step 5: Run page tests and verify RED**

Run: `pnpm test src/app/auth/wallboard-sign-in/page.test.tsx`

Expected: FAIL because the page does not exist.

- [ ] **Step 6: Build the branded page and capability-aware wallboard header**

Use `CommandCentreLogo`, current canvas/surface/orange tokens, compact controls,
and familiar input labels. Change unauthenticated wallboard redirect to:

```text
/auth/wallboard-sign-in
```

Pass `canAccessDispatch={access.accessLevel === "staff"}`. Hide the Dispatch
link for wallboard-only sessions. Send wallboard sign-out to
`/auth/wallboard-sign-in`.

- [ ] **Step 7: Run UI tests and commit**

Run:

```powershell
pnpm test src/app/auth/wallboard-sign-in src/app/wallboard
git add src/app/auth/wallboard-sign-in src/app/wallboard
git commit -m "feat: add local wallboard sign-in"
```

Expected: tests PASS and commit succeeds.

---

### Task 5: Environment Documentation And Credential Generator

**Files:**
- Create: `scripts/generate-wallboard-password-hash.mjs`
- Create: `scripts/generate-wallboard-password-hash.test.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: the same versioned `scrypt` format as `wallboard-password.ts`
- Produces: `pnpm wallboard:hash`

- [ ] **Step 1: Write a failing generator compatibility test**

Run the generator with a supplied test password through a child process and
verify `verifyWallboardPassword` accepts the output. Ensure stdout contains
only the encoded hash and never the raw password.

- [ ] **Step 2: Run the generator test and verify RED**

Run: `pnpm test scripts/generate-wallboard-password-hash.test.ts`

Expected: FAIL because the script and package command do not exist.

- [ ] **Step 3: Implement generator and documentation**

The script reads `WALLBOARD_PASSWORD` from its process environment and exits
with a clear error when missing. It writes only the encoded hash.

Add:

```json
"wallboard:hash": "node scripts/generate-wallboard-password-hash.mjs"
```

Document:

```dotenv
WALLBOARD_LOCAL_USERNAME=
WALLBOARD_LOCAL_PASSWORD_HASH=
```

README setup must say the account is wallboard-only, uses a 30-day session,
and must not be reused as a staff password.

- [ ] **Step 4: Run documentation/generator tests and commit**

Run:

```powershell
pnpm test scripts/generate-wallboard-password-hash.test.ts src/app/auth/env-example.test.ts
git add scripts/generate-wallboard-password-hash* package.json .env.example README.md
git commit -m "docs: add wallboard credential setup"
```

Expected: tests PASS and commit succeeds.

---

### Task 6: Full Verification, Database Migration, Production Configuration, And Deployment

**Files:**
- No additional production files unless verification exposes a regression.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: deployed production wallboard local login.

- [ ] **Step 1: Install dependencies and run all checks**

Run:

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm build
```

Expected: all tests pass, ESLint exits 0, production build exits 0.

- [ ] **Step 2: Review least-privilege boundaries**

Run:

```powershell
rg -n "getWallboardAccess|wallboard-only|accessLevel" src
git diff origin/main --check
git status --short
```

Confirm wallboard approval appears only in the wallboard page and presence GET.

- [ ] **Step 3: Apply the Supabase migration**

Link to the existing production Supabase project and apply only
`20260727090000_wallboard_login_attempts.sql`. Confirm the table and index
exist with RLS enabled and no anon/authenticated grants.

- [ ] **Step 4: Generate and configure the production credential**

Generate a strong random wallboard password locally. Set:

```text
WALLBOARD_LOCAL_USERNAME=wallboard
WALLBOARD_LOCAL_PASSWORD_HASH=<generated scrypt hash>
```

in Vercel Production only. Do not set a public variable and do not store the
plaintext password in the repository.

- [ ] **Step 5: Deploy the exact verified commit**

Push the feature branch, fast-forward `main` after verification, and deploy the
same commit to the existing `egit-dispatch` Vercel project. Confirm
`command.egit.com.au` aliases the Ready deployment.

- [ ] **Step 6: Browser-verify production**

In a signed-out/private browser:

1. Open `/wallboard`; verify redirect to local wallboard sign-in.
2. Enter invalid credentials; verify generic error.
3. Enter the generated credential; verify Wallboard loads and refreshes.
4. Open `/dispatch`; verify redirect back to `/wallboard`.
5. Verify no Dispatch link is visible.
6. Verify `GET /api/internal/presence` succeeds.
7. Verify a write/integration endpoint returns 403.
8. Restart the browser; verify the 30-day session persists.
9. Sign out; verify return to local wallboard sign-in.
10. Sign in through Zoho as approved staff; verify Dispatch and Wallboard still work.

- [ ] **Step 7: Final commit/push status**

Run:

```powershell
git status --short
git log --oneline origin/main..HEAD
```

Expected: clean worktree and all intended commits present in production.

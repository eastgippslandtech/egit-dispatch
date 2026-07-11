# Command Centre Logo Brand Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the technician mobile app visually match the supplied Command Centre logo pack.

**Architecture:** Keep the current Expo Router shell and native tabs. Centralise brand colours in `src/theme/tokens.ts`, use a real PNG logo asset on sign-in, and wire the same raster asset into Expo icon and Android adaptive-icon config.

**Tech Stack:** Expo 57, React Native 0.86, Expo Router, Vitest, react-test-renderer.

## Global Constraints

- Logo navy is `#071526`.
- Logo orange is `#FF823A`.
- Logo red is `#F21F31`.
- Do not add runtime dependencies for this refresh.
- Preserve existing route names, tab names, and mock Zoho sign-in behaviour.

---

### Task 1: Brand Contract Tests

**Files:**
- Create: `apps/technician-mobile/src/theme/tokens.test.ts`
- Modify: `apps/technician-mobile/app/navigation.test.tsx`

**Interfaces:**
- Consumes: `colours` from `src/theme/tokens.ts`
- Produces: failing tests for brand colours, sign-in brand image, and active tab accent

- [x] **Step 1: Write the failing tests**

Add a theme test expecting `brandNavy`, `brandOrange`, `brandRed`, `canvas`, `primary`, and `critical`.

Update the navigation harness to capture `tabBarActiveTintColor`, mock `Image`, and assert the sign-in route renders an image with accessibility label `Command Centre brand mark`.

- [x] **Step 2: Run tests to verify failure**

Run: `npm test -- src/theme/tokens.test.ts app/navigation.test.tsx`

Expected: FAIL because the current theme has no brand palette fields and the sign-in route renders no brand image.

### Task 2: Apply Brand Assets And UI

**Files:**
- Modify: `apps/technician-mobile/src/theme/tokens.ts`
- Modify: `apps/technician-mobile/app/sign-in.tsx`
- Modify: `apps/technician-mobile/app/(tabs)/_layout.tsx`
- Modify: `apps/technician-mobile/app.config.ts`
- Create: `apps/technician-mobile/assets/brand/app-icon.png`

**Interfaces:**
- Consumes: logo files from `/Users/simeon/Desktop/egit-app-logos 5/final/command-centre/`
- Produces: app-level theme tokens, sign-in brand image, warm active navigation, Expo icon/adaptive-icon configuration

- [x] **Step 1: Implement minimal code**

Copy the supplied app icon into `assets/brand/`, update `colours`, show `app-icon.png` on sign-in with accessible image text, update CTA and tab active tint to `colours.primary`, and configure Expo `icon` plus Android `adaptiveIcon`.

- [x] **Step 2: Run tests**

Run: `npm test -- src/theme/tokens.test.ts app/navigation.test.tsx`

Expected: PASS.

### Task 3: Verification And Git

**Files:**
- Read: modified files and git diff

**Interfaces:**
- Consumes: completed implementation
- Produces: verified branch with a commit

- [x] **Step 1: Run full checks**

Run: `npm test`, `npm run typecheck`, and `npm run lint`.

- [x] **Step 2: Commit**

Stage all changed files and commit with message `style: align technician app with command centre brand`.

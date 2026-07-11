# Command Centre Brand Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the supplied Command Centre logo pack and navy/orange/red visual system across dispatch, authentication, technician mobile, browser metadata, and future native assets without changing application behavior or layout geometry.

**Architecture:** Copy approved assets into a stable public brand directory, expose them through one accessible `CommandCentreLogo` component, and centralize semantic colours in `globals.css`. Existing screens are updated in place to consume the component and tokens; business logic and operational layout remain untouched.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Vitest, Testing Library, Playwright.

## Global Constraints

- Source assets come from `C:/Users/SimeonWeller/Downloads/egit-complete-app-logo-pack/egit-app-logos/final/command-centre/`.
- Preserve all current layouts, workflows, data, integrations, scheduling calculations, timeline math, drag/drop, filters, timer, notes, evidence, parts, and sign-off behavior.
- Use `#071526`, `#FF823A`, `#F21F31`, and `#FFFFFF` as core identity colours.
- Preserve booking priority colours and semantic success/warning/information meanings.
- Orange means interaction/selection/current time; red means critical/destructive/conflict.
- Do not use CSS zoom, page transforms, marketing decoration, or new animations.
- Preserve every pre-existing dirty file and work with its current contents.

---

### Task 1: Install Brand Assets And Shared Logo Component

**Files:**
- Create: `public/assets/command-centre/favicon.svg`
- Create: `public/assets/command-centre/icon-full-colour.svg`
- Create: `public/assets/command-centre/icon-dark.svg`
- Create: `public/assets/command-centre/icon-light.svg`
- Create: `public/assets/command-centre/logo-horizontal-dark.svg`
- Create: `public/assets/command-centre/logo-horizontal-light.svg`
- Create: `public/assets/command-centre/logo-stacked-dark.svg`
- Create: `public/assets/command-centre/logo-stacked-light.svg`
- Create: `public/assets/command-centre/powered-by-egit-dark.svg`
- Create: `public/assets/command-centre/powered-by-egit-light.svg`
- Create: `public/assets/command-centre/app-icon-64.png`
- Create: `public/assets/command-centre/app-icon-128.png`
- Create: `public/assets/command-centre/app-icon-256.png`
- Create: `public/assets/command-centre/app-icon-512.png`
- Create: `public/assets/command-centre/app-icon-1024.png`
- Create: `public/assets/command-centre/native/**`
- Create: `src/app/components/command-centre-logo.tsx`
- Test: `src/app/components/command-centre-logo.test.tsx`

**Interfaces:**
- Produces: `CommandCentreLogo({ variant, className, decorative })` and stable `/assets/command-centre/*` URLs.

- [ ] **Step 1: Write failing logo component tests**

```tsx
render(<CommandCentreLogo variant="horizontal-dark" />);
expect(screen.getByRole("img", { name: "Command Centre" })).toHaveAttribute(
  "src",
  "/assets/command-centre/logo-horizontal-dark.svg",
);

render(<CommandCentreLogo variant="icon-colour" decorative />);
expect(screen.getByRole("presentation")).toHaveAttribute("alt", "");
```

- [ ] **Step 2: Run the test and verify RED**

Run: `corepack pnpm test src/app/components/command-centre-logo.test.tsx`  
Expected: FAIL because the component does not exist.

- [ ] **Step 3: Copy the approved assets without modifying artwork**

Use `Copy-Item` for exact binary/SVG copies. Preserve the full supplied `mobile/` directory under `public/assets/command-centre/native/` for the future native app.

- [ ] **Step 4: Implement the typed logo component**

```tsx
const sources = {
  "horizontal-dark": "/assets/command-centre/logo-horizontal-dark.svg",
  "horizontal-light": "/assets/command-centre/logo-horizontal-light.svg",
  "stacked-dark": "/assets/command-centre/logo-stacked-dark.svg",
  "stacked-light": "/assets/command-centre/logo-stacked-light.svg",
  "icon-colour": "/assets/command-centre/icon-full-colour.svg",
  "powered-by-dark": "/assets/command-centre/powered-by-egit-dark.svg",
  "powered-by-light": "/assets/command-centre/powered-by-egit-light.svg",
} as const;
```

Render `next/image` with `unoptimized` for SVG assets, stable intrinsic dimensions per variant, `alt="Command Centre"` by default, and `alt=""` when decorative.

- [ ] **Step 5: Verify GREEN**

Run: `corepack pnpm test src/app/components/command-centre-logo.test.tsx`  
Expected: PASS.

### Task 2: Apply Metadata And Semantic Brand Tokens

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Modify: `public/manifest.webmanifest`
- Test: `src/app/page.test.tsx`

**Interfaces:**
- Consumes: `/assets/command-centre/favicon.svg` and app-icon PNGs.
- Produces: `--cc-*` semantic CSS variables available to all screens.

- [ ] **Step 1: Add failing metadata/token assertions**

Assert layout metadata points to `/assets/command-centre/favicon.svg`, Apple icon `/assets/command-centre/app-icon-1024.png`, manifest icons use new paths, and `globals.css` contains `--cc-brand-orange: #ff823a` plus the approved token set.

- [ ] **Step 2: Run targeted tests and verify RED**

Run: `corepack pnpm test src/app/page.test.tsx`  
Expected: FAIL on legacy asset paths/missing tokens.

- [ ] **Step 3: Add exact semantic tokens**

Define the complete approved token table from the design spec and set body canvas/text from `--cc-canvas` and `--cc-text`. Keep Geist as the application font.

- [ ] **Step 4: Update metadata and manifest**

Set theme colour to `#071526`, favicon to the supplied SVG, Apple icon to 1024 PNG, and manifest 192/512 purposes to the closest supplied high-resolution icons.

- [ ] **Step 5: Verify GREEN**

Run: `corepack pnpm test src/app/page.test.tsx`  
Expected: PASS.

### Task 3: Reskin Authentication And Desktop Dispatch

**Files:**
- Modify: `src/app/auth/auth-screen.tsx`
- Modify: `src/app/auth/sign-in/page.test.tsx`
- Modify: `src/app/auth/access-denied/page.test.tsx`
- Modify: `src/app/dispatch/command-centre/prototype.tsx`
- Modify: `src/app/dispatch/command-centre/page.test.tsx`

**Interfaces:**
- Consumes: `CommandCentreLogo` and `--cc-*` tokens.
- Preserves: all component props, state, interactions, and timeline calculations.

- [ ] **Step 1: Add failing brand assertions**

Authentication tests assert the stacked dark logo source. Dispatch tests assert the horizontal dark logo source, accessible Command Centre name, orange-selected Day state, and absence of active legacy bitmap logo paths.

- [ ] **Step 2: Run targeted tests and verify RED**

Run: `corepack pnpm test src/app/auth src/app/dispatch/command-centre/page.test.tsx`  
Expected: FAIL on legacy branding.

- [ ] **Step 3: Reskin auth surfaces**

Replace legacy bitmap assets with `stacked-dark`/`icon-colour`; use token-backed navy surfaces, orange primary action/focus, red blocked state, and silver secondary text. Preserve copy and auth behavior.

- [ ] **Step 4: Reskin dispatch chrome in place**

Replace the bitmap-plus-title header with `horizontal-dark`, keeping a visually hidden H1 when required. Replace cyan chrome with token-backed orange active/focus/selection/current-time classes. Preserve priority classes, warning amber, success green, conflict red, layout tracks, height, scrolling, and all event handlers.

- [ ] **Step 5: Verify GREEN and dispatch regressions**

Run: `corepack pnpm test src/app/auth src/app/dispatch/command-centre/page.test.tsx`  
Expected: PASS, including existing drag/drop, filtering, timing, notes, and scheduling tests.

### Task 4: Reskin Technician Mobile Web

**Files:**
- Modify: `src/app/mobile/mobile-app.tsx`
- Modify: `src/app/mobile/page.test.tsx`

**Interfaces:**
- Consumes: `CommandCentreLogo` and `--cc-*` tokens.
- Preserves: timer, technician job flows, native action links, notes, evidence, parts, and sign-off behavior.

- [ ] **Step 1: Add failing mobile branding tests**

Assert the compact colour icon is present, primary actions use the brand-primary class, and the timer bar still exposes a live elapsed time label.

- [ ] **Step 2: Run and verify RED**

Run: `corepack pnpm test src/app/mobile/page.test.tsx`  
Expected: FAIL on missing new logo/theme markers.

- [ ] **Step 3: Apply mobile brand tokens**

Add the colour icon to the compact header. Replace cyan-led surfaces/actions/focus states with navy/orange token classes while retaining semantic priority, warning, success, error, internal/external note, and timer states.

- [ ] **Step 4: Verify GREEN**

Run: `corepack pnpm test src/app/mobile/page.test.tsx`  
Expected: PASS, including timer, notes, evidence, sign-off, parts, and privacy tests.

### Task 5: Full Verification And Browser Review

**Files:**
- Modify only files required by test or visual defects discovered during verification.

**Interfaces:**
- Verifies the complete visual reskin and unchanged behavior.

- [ ] **Step 1: Run automated gate**

```bash
corepack pnpm test
corepack pnpm lint
corepack pnpm build
```

Expected: all exit zero.

- [ ] **Step 2: Start local production-equivalent UI**

Run: `corepack pnpm dev` on an available local port and keep it running for browser checks.

- [ ] **Step 3: Capture and inspect desktop views**

Verify `/dispatch` at 1920x1080 and 1440x900: horizontal logo, compact health, queue, timeline, drawer, orange focus/selection/current time, priority colours, no page-level scroll, no clipped text, and no console errors.

- [ ] **Step 4: Capture and inspect auth/mobile views**

Verify sign-in, access denied, and `/mobile` at 390x844 and 412x915: correct logo variants, readable contrast, functional timer bar, usable touch targets, no overlap, and no console errors.

- [ ] **Step 5: Scan active code for legacy branding and cyan dominance**

Run:

```bash
rg -n "command-centre-logo\.png|command-centre-logo-header\.png" src public/manifest.webmanifest
rg -n "cyan-" src/app/auth src/app/dispatch/command-centre src/app/mobile
```

Expected: no active legacy logo references; remaining cyan references are removed or justified informational colours rather than primary interaction chrome.

- [ ] **Step 6: Review working tree**

Confirm no business-logic changes were introduced, no pre-existing dirty work was reverted, and only intended brand files plus test adjustments are present.

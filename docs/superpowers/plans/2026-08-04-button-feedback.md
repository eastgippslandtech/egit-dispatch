# Button Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Command Centre button immediate pressed feedback and every server-backed action a clear, duplicate-safe pending state.

**Architecture:** Global CSS supplies consistent pressed feedback and an `aria-busy` spinner without changing button dimensions. Existing local request state remains the source of truth for pending actions; buttons expose that state through `disabled`, `aria-busy`, and explicit action text. Form actions use `useFormStatus` so pending feedback begins during native submission.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS, Vitest, Testing Library.

## Global Constraints

- Keep the current layout and visual design unchanged.
- Do not add a new button library.
- Disable pending server actions to prevent duplicate submissions.
- Do not show spinners for immediate view, filter, or toggle controls.
- Preserve accessible button names and expose pending state with `aria-busy`.

---

### Task 1: Shared interaction feedback

**Files:**
- Modify: `src/app/globals.css`
- Create: `src/app/components/button-feedback.test.tsx`

- [ ] Write a failing test asserting a busy button is disabled, has `aria-busy`, and shows action-specific pending text.
- [ ] Add global pressed styles for enabled buttons and a reduced-motion-safe pending spinner for `button[aria-busy="true"]`.
- [ ] Run the focused test and confirm it passes.

### Task 2: Command Centre server actions

**Files:**
- Modify: `src/app/dispatch/command-centre/prototype.tsx`
- Modify: `src/app/dispatch/command-centre/page.test.tsx`

- [ ] Add failing interaction tests for scheduling, request creation, communication, Work Log, merge, and Track pending labels.
- [ ] Add `aria-busy`, disabling, and explicit labels such as `Scheduling...`, `Creating...`, `Sending...`, `Saving Work Log...`, `Merging...`, and `Saving Track...`.
- [ ] Confirm each async handler sets pending state before awaiting and clears it in `finally` or closes the completed flow.
- [ ] Run focused Command Centre tests.

### Task 3: Authentication, presence, and recovery actions

**Files:**
- Modify: `src/app/auth/zoho-submit-button.tsx`
- Create: `src/app/auth/wallboard-sign-in/submit-button.tsx`
- Modify: `src/app/auth/wallboard-sign-in/page.tsx`
- Modify: `src/app/components/presence-controls.tsx`
- Modify: `src/app/integrations/failed-actions.tsx`
- Modify: `src/app/integrations/screen.tsx`
- Modify or create focused tests beside these components.

- [ ] Add failing tests for sign-in, presence updates, retry, cancel, and refresh pending states.
- [ ] Use `useFormStatus` for Zoho and Wallboard form actions.
- [ ] Expose per-action pending labels and disable only the relevant controls where practical.
- [ ] Run the focused tests.

### Task 4: Verification and release

**Files:**
- Review all modified files.

- [ ] Run `pnpm test`.
- [ ] Run `pnpm lint`.
- [ ] Run `pnpm build`.
- [ ] Browser-check primary instant and pending controls without layout shift.
- [ ] Commit, push, deploy production, and verify `https://command.egit.com.au/dispatch` responds successfully.

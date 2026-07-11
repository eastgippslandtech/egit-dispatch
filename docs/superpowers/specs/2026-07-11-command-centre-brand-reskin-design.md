# Command Centre Brand Reskin Design

**Date:** 11 July 2026  
**Status:** Approved design  
**Scope:** Visual reskin of the complete existing Command Centre application

## Objective

Replace the current cyan-led Command Centre styling and legacy logo assets with the supplied Command Centre logo pack. The application should feel designed around the new identity while preserving the existing layouts, workflows, information density, and behavior.

This is a brand reskin, not a structural redesign. The dispatch board remains calendar-first and operational. The technician experience retains its current workflow. Authentication and blocked/error screens adopt the same visual system.

## Source Assets

The approved source pack is:

`C:/Users/SimeonWeller/Downloads/egit-complete-app-logo-pack/egit-app-logos/final/command-centre/`

Use the supplied files without redrawing the mark:

- `logo-horizontal-dark.svg`: desktop Command Centre header.
- `logo-horizontal-light.svg`: approved light-background fallback.
- `logo-stacked-dark.svg`: sign-in and authentication surfaces.
- `logo-stacked-light.svg`: approved light-background fallback.
- `icon-full-colour.svg`: compact/mobile application header.
- `icon-dark.svg` and `icon-light.svg`: monochrome context variants.
- `favicon.svg`: browser favicon.
- `app-icon-*.png`: web manifest and installable application icons.
- `powered-by-egit-dark.svg` and `powered-by-egit-light.svg`: optional secondary/auth attribution only.
- `mobile/`: future native iOS and Android icon assets.

The old `command-centre-logo.png` and `command-centre-logo-header.png` assets stop being active application branding after migration. They may remain temporarily only when required to avoid breaking historical exports.

## Visual Direction

The selected direction is **Operational Brand System**.

The interface uses deep EGIT navy as its working canvas, slightly lighter navy layers for structure, orange for interaction and selection, red for critical/destructive states, and white/silver for typography and dividers. The logo is the strongest brand expression; the operational interface remains restrained.

Do not introduce orange framing around every panel or broad red decorative surfaces. Do not add marketing-style gradients, oversized brand decoration, or animation. The result must remain a serious internal dispatch tool that is glanceable on a large display.

## Brand Tokens

Define semantic CSS custom properties in `src/app/globals.css` and consume them throughout the app.

### Core Identity

| Token | Value | Use |
| --- | --- | --- |
| `--cc-brand-navy` | `#071526` | Canonical logo navy and primary surface. |
| `--cc-brand-orange` | `#FF823A` | Primary interaction, active state, focus, and current time. |
| `--cc-brand-red` | `#F21F31` | Critical, destructive, conflict, and blocking failure. |
| `--cc-brand-white` | `#FFFFFF` | Strong foreground and logo contrast. |

### Application Surfaces

| Token | Value | Use |
| --- | --- | --- |
| `--cc-canvas` | `#040B14` | App/page canvas. |
| `--cc-surface-1` | `#071526` | Header and primary panel surface. |
| `--cc-surface-2` | `#0B1D33` | Nested tools, rows, drawers, and inputs. |
| `--cc-surface-3` | `#102741` | Hovered/elevated operational surface. |
| `--cc-border` | `#223B55` | Standard divider and panel border. |
| `--cc-border-strong` | `#3A536B` | Interactive/structural border. |

### Foreground And Status

| Token | Value | Use |
| --- | --- | --- |
| `--cc-text` | `#F7F9FC` | Main text. |
| `--cc-text-secondary` | `#C8D1DC` | Secondary text. |
| `--cc-text-muted` | `#7F93AA` | Metadata and subdued labels. |
| `--cc-success` | `#2FC98F` | Connected, complete, and successful state. |
| `--cc-warning` | `#F2C14E` | SLA warnings and caution states. |
| `--cc-info` | `#5DADE2` | Neutral informational status where orange would imply selection. |

Use translucent derivatives through `color-mix()` or fixed rgba values for soft backgrounds. The solid core values remain the source of truth.

## Semantic Colour Rules

- Orange means action, focus, active selection, drag target, or the current moment.
- Red means critical priority, destructive action, conflict, or blocking failure.
- Amber means warning, due-soon, SLA concern, or caution.
- Green means successful, connected, completed, or healthy.
- Blue is informational only and no longer the dominant application accent.
- White/silver communicates hierarchy without adding another accent family.

Do not replace established booking priority colours:

- Critical: red.
- High: amber/yellow.
- Medium: green.
- Low: blue.
- Outlook-only/unlinked: neutral slate.

Selection is an orange edge/focus treatment around the priority-coloured booking, not an orange replacement fill. Travel buffers remain secondary ghost extensions attached to the priority card.

## Shared Brand Components

Create a reusable `CommandCentreLogo` component with explicit variants:

- `horizontal-dark`
- `horizontal-light`
- `stacked-dark`
- `stacked-light`
- `icon-colour`
- `powered-by-dark`
- `powered-by-light`

The component owns intrinsic aspect ratio, accessible label behavior, and responsive sizing. Decorative instances use empty alt text. Primary brand instances use `Command Centre` alt text. Do not repeat a visible `Command Centre` heading beside a horizontal logo that already contains the name unless the heading is required for document semantics and visually hidden.

## Screen Application

### Desktop Dispatch Board

Preserve the current three-column composition:

- compact Dispatch Health summary.
- left unscheduled request queue.
- central technician timeline.
- right request detail drawer.

Use `logo-horizontal-dark.svg` in the header. The lockup replaces the current small bitmap plus duplicated visible title. Connection and read-only indicators remain compact secondary badges.

Replace cyan interaction styling with orange for:

- active Day/Week control.
- Today and primary action buttons.
- keyboard focus rings.
- selected queue/request edges.
- selected appointment outline.
- active health/filter state.
- drag/drop target and ghost preview outline.
- current-time line and label.

Keep calendar grid lines, technician separators, drawer dividers, inputs, and neutral buttons in navy/silver. Appointment priority fills remain the strongest timeline content. Search dimming, overlap groups, travel buffers, conflict styling, and sticky technician labels retain their behavior.

### Dispatch Health

Preserve compact primary cards, More Health, filtering, toggle-off behavior, and counts. Zero-count cards remain quieter. Active selection uses an orange border/inner highlight independent of the card's issue colour. Non-zero issue cards continue to use their semantic severity.

### Queue And Request Drawer

Selected queue cards and the corresponding drawer use a shared orange edge cue. Inputs use orange focus borders. Primary actions are orange with navy text. Destructive actions use red. Secondary actions remain dark navy with silver borders. Internal/external note visibility must remain explicit in text and not depend on colour alone.

### Authentication

Use `logo-stacked-dark.svg` prominently on sign-in. The page remains a quiet navy surface with one orange `Sign in with Zoho` button. Do not add explanatory marketing content.

Access-denied and server-error states use `icon-full-colour.svg`, concise copy, and red only for the blocking message/action. The brand mark remains calm and readable.

### Technician Mobile Web

Use `icon-full-colour.svg` in compact headers. Apply the same surface, typography, button, focus, note, warning, and status tokens while preserving current technician workflow and behavior.

The active timer bar must remain prominent and continue live counting. Orange may identify the active timer; elapsed time and stop controls must remain readable and accessible. Native phone, email, maps, evidence, notes, sign-off, and parts controls retain existing behavior.

### Browser And Installable Metadata

- Replace metadata favicon with the supplied `favicon.svg`.
- Use appropriately sized `app-icon-*.png` files in `manifest.webmanifest` and Apple web-app metadata.
- Set browser/theme colour to `#071526`.
- Preserve the complete supplied native mobile icon directory in a documented repository asset location for the future Expo application.

## Typography And Shape

Retain Geist for application UI and Geist Mono where identifiers/times benefit from fixed-width numerals. The logo's internal Inter text is part of the supplied artwork and does not require changing application typography.

Preserve compact desktop density. Use existing small radii and operational spacing. Cards remain at or below 8px radius. Do not introduce pill-shaped containers except status badges, segmented controls, or compact metadata where they already make semantic sense.

## Interaction And Accessibility

- Every interactive control keeps visible hover, active, focus-visible, disabled, and selected states.
- Focus-visible uses a high-contrast orange ring plus sufficient offset from orange controls.
- Orange buttons use navy text and must meet WCAG AA contrast at their actual size/weight.
- Red and amber states include text/icon cues; colour alone never carries meaning.
- Logo components preserve SVG aspect ratio and cannot cause header height or layout shift.
- Touch targets remain usable in technician mobile layouts.
- Reduced-motion behavior remains respected; the reskin adds no required animation.

## Architecture And Scope Boundaries

Centralize tokens and logo rendering. Update existing components in place rather than creating parallel versions of dispatch, auth, or mobile screens.

No changes are permitted to:

- data models or mock/live data selection.
- Zoho authentication behavior.
- Microsoft Graph or MSP Central integration behavior.
- scheduling calculations or appointment duration rules.
- search/filter semantics.
- health calculations/filter mapping.
- drag/drop and conflict detection.
- timeline positioning, travel windows, or current-time math.
- timer, worklog, repair-note, evidence, parts, or sign-off behavior.
- desktop grid geometry or mobile workflow order.

Small markup changes are allowed only to replace duplicated branding, expose reusable logo components, and apply semantic class names/tokens.

## Testing And Visual Verification

Run:

```bash
corepack pnpm test
corepack pnpm lint
corepack pnpm build
```

Update/add focused tests for:

- metadata and manifest asset paths.
- correct logo variant on sign-in, access denied, dispatch header, and technician mobile header.
- removal of active references to legacy bitmap logos.
- preservation of accessible names when visible duplicate header text is removed.

Use Playwright for visual verification at minimum:

- desktop dispatch at 1920x1080, 1440x900, and a narrower supported desktop width.
- sign-in and access-denied screens.
- technician mobile at representative iPhone and Android viewport sizes.
- hover/focus/selected states.
- non-zero and zero health cards.
- appointment priorities, overlap stack, travel buffers, current-time line, and drawer selection.
- active timer bar and note visibility states.

Check for horizontal/vertical overflow, accidental page scroll, clipped logos, unreadable text, colour collisions, and layout shifts. The calendar remains the desktop hero and no app-level scrolling regression is accepted.

## Acceptance Criteria

- The supplied Command Centre logo pack is the active source of branding across the complete app.
- Desktop dispatch, sign-in, access denied, technician mobile, favicon, and manifest icons use the correct variants.
- The application visibly uses the navy/orange/red/white identity without becoming orange-dominated.
- Cyan is no longer the primary interaction accent.
- Existing priority/status meanings remain intact.
- Layouts, workflows, integrations, calculations, and interactions are unchanged.
- Shared semantic tokens and logo components prevent styling drift.
- Desktop and mobile visual checks show no overlap, clipping, or scrolling regressions.
- Tests, lint, and production build pass.

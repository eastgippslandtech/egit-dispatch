# Task 6 Report: Job Detail and Native Contact Actions

## Status

Complete.

## Implementation

- Added native job detail route and detail component.
- Shows request/context, customer/site/contact data, service context, previous notes, read-only reason, and permission-driven actions.
- Outlook-only jobs show `Outlook Read Only` and disable write actions.
- Added native linking helpers that call `Linking.canOpenURL()` before opening phone, email, maps, or Outlook URLs.

## Verification

- Initial focused tests failed on missing modules.
- Focused job detail tests pass.
- Native typecheck and lint pass for the slice.

## Files

- `apps/technician-mobile/app/job/[jobId].tsx`
- `apps/technician-mobile/src/features/jobs/job-detail.tsx`
- `apps/technician-mobile/src/features/jobs/native-actions.ts`
- `apps/technician-mobile/src/features/jobs/job-detail.test.tsx`

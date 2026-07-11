# Task 11 Report: On-Demand ETA and Maps Handoff

## Status

Complete.

## Implementation

- Installed SDK-compatible foreground location module.
- Added ETA service that requests location only when calculate is called.
- The service uses one foreground position request and does not start a watcher.
- Persisted ETA output excludes raw coordinates.
- Added maps handoff helper and native ETA panel.
- Added foreground-only location permission copy in Expo config.

## Verification

- Initial focused ETA tests failed on missing module.
- Focused ETA tests pass.
- Native typecheck and lint pass for the slice.

## Files

- `apps/technician-mobile/src/features/jobs/eta-service.ts`
- `apps/technician-mobile/src/features/jobs/eta-panel.tsx`
- `apps/technician-mobile/src/features/jobs/eta-service.test.ts`
- `apps/technician-mobile/app.config.ts`

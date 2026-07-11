# Task 9 Report: Native Evidence Capture and Retry-Safe Upload Staging

## Status

Complete.

## Implementation

- Installed SDK-compatible camera, image picker, document picker, and file-system modules.
- Added evidence staging service with pending/uploading/failed/synced states.
- Failed evidence retains the protected local URI for retry.
- Local evidence cleanup is only allowed after a synced receipt state.
- Added native picker wrappers and evidence list UI.
- Added precise camera/photo permission copy in Expo config.

## Verification

- Initial focused evidence test failed on missing module.
- Focused evidence test passes.
- Native typecheck and lint pass for the slice.

## Files

- `apps/technician-mobile/src/features/evidence/evidence-picker.ts`
- `apps/technician-mobile/src/features/evidence/evidence-list.tsx`
- `apps/technician-mobile/src/features/evidence/evidence-service.ts`
- `apps/technician-mobile/src/features/evidence/evidence-service.test.ts`
- `apps/technician-mobile/app.config.ts`

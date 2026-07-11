# Command Centre Technician Mobile

Native iOS/Android technician app built with Expo Router and React Native. It is not a WebView/PWA wrapper.

## Local app

```bash
pnpm --dir apps/technician-mobile start
pnpm --dir apps/technician-mobile ios
pnpm --dir apps/technician-mobile android
```

The simulator build uses deterministic mock technician data by default so Today, My Work, Sync, Profile, job detail, timers, work notes, Outlook read-only handling, evidence, parts, sign-off, ETA, and offline queue behaviours can be exercised without production credentials.

## Quality gate

```bash
pnpm --dir apps/technician-mobile exec expo-doctor
pnpm --dir apps/technician-mobile typecheck
pnpm --dir apps/technician-mobile lint
pnpm --dir apps/technician-mobile test
pnpm --dir apps/technician-mobile exec expo export --platform ios
pnpm --dir apps/technician-mobile exec expo export --platform android
```

Root regression gate:

```bash
pnpm test
pnpm lint
pnpm build
```

Secret scan:

```bash
rg -n "(AUTH_SECRET|NEXTAUTH_SECRET|SUPABASE_SERVICE_ROLE|client_secret\\s*[:=]|MICROSOFT_CLIENT_SECRET|MSP_CENTRAL.*SECRET|ZOHO_CLIENT_SECRET|Bearer\\s+[A-Za-z0-9._-]{20,}|sk-[A-Za-z0-9])" apps/technician-mobile -g '!README.md' -g '!**/*.test.ts'
```

## Maestro smoke flows

```bash
maestro test apps/technician-mobile/maestro/sign-in-mock.yaml
maestro test apps/technician-mobile/maestro/timer-restart.yaml
maestro test apps/technician-mobile/maestro/offline-note.yaml
maestro test apps/technician-mobile/maestro/outlook-read-only.yaml
```

The checked-in flows use the development-client URL opened during local verification on this Mac: `http://192.168.69.170:8081`. If the Mac’s LAN IP changes, update the `openLink` URL in the four flow files before running them.

For Android emulator runs, pass the Android device id if iOS is also booted:

```bash
maestro --device emulator-5554 test apps/technician-mobile/maestro/sign-in-mock.yaml
```

The flows use accessibility labels and visible text, not screen coordinates.

## EAS preview builds

```bash
pnpm dlx eas-cli build --platform ios --profile preview
pnpm dlx eas-cli build --platform android --profile preview
```

Preview distribution requires Expo project ownership plus Apple and Google signing/account access. Stop at credential prompts and retain local simulator/export verification if those external credentials are unavailable.

Current handoff status: both preview commands are blocked on this Mac until `eas login` is completed or `EXPO_TOKEN` is set.

## Runtime security notes

- Zoho mobile auth is authorization-code + PKCE; no Zoho client secret is stored in the native app.
- Command Centre sessions are stored through SecureStore.
- SQLite stores cached jobs, timers, staged evidence metadata, drafts, and mutation queue state, not bearer or refresh tokens.
- Push tokens are registered only after explicit user opt-in and are not echoed in API responses.
- ETA uses foreground location only after the user taps Calculate ETA.

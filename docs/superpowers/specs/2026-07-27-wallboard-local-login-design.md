# Wallboard Local Login Design

## Goal

Allow the dedicated wallboard PC to sign in without a Zoho user account while
keeping Command Centre staff authentication and permissions unchanged.

## User Experience

- An unauthenticated visitor to `/wallboard` is sent to
  `/auth/wallboard-sign-in`.
- The page uses the existing Command Centre branding and asks for a wallboard
  username and password.
- A successful login returns directly to `/wallboard`.
- The wallboard session persists across browser restarts for 30 days.
- The wallboard header keeps a sign-out action.
- Invalid credentials show a generic error without revealing which field was
  wrong.
- There is no signup, password-reset, account-management, or local login on the
  staff sign-in page.

## Authorization Model

Auth.js remains the single session system.

- Zoho sessions receive the existing `staff` access level.
- The credentials provider issues a `wallboard` access level only after
  validating the dedicated wallboard username and password.
- A wallboard session may access:
  - `/wallboard`
  - the read-only presence endpoint required for live wallboard refreshes
- A wallboard session may not access:
  - `/dispatch`
  - internal write endpoints
  - Graph, MSP Central, identity, readiness, or scheduling endpoints
  - mobile technician endpoints
- Attempting to open `/dispatch` with a wallboard session redirects back to
  `/wallboard`.
- Existing allowlisted Zoho staff retain access to both Dispatch and Wallboard.

The access decision is represented explicitly in the server-side session model
rather than inferred from a display name or synthetic email address.

## Credential Storage

Production credentials are stored only as protected Vercel environment
variables:

- `WALLBOARD_LOCAL_USERNAME`
- `WALLBOARD_LOCAL_PASSWORD_HASH`

The password is stored as a salted password hash, never as plaintext. The
browser stores only the normal secure, HTTP-only Auth.js session cookie.
Credentials are not exposed through public environment variables, logs, page
props, or API responses.

Local development may use the same variables in a developer-only environment
file. `.env.example` documents the variable names without real values.

## Authentication Flow

1. The wallboard sign-in form submits to a server action.
2. Auth.js invokes a dedicated credentials provider.
3. The provider normalizes the username and verifies the submitted password
   against `WALLBOARD_LOCAL_PASSWORD_HASH`.
4. On success, Auth.js creates a signed session carrying
   `accessLevel: "wallboard"`.
5. Server-side wallboard authorization accepts either an approved staff session
   or the wallboard access level.
6. General Command Centre authorization continues to accept approved staff
   sessions only.

## Abuse And Failure Handling

- Credential comparison uses the password-hash library's constant-time
  verification.
- Five failed attempts for the same wallboard username and client address
  within 15 minutes block further attempts for 15 minutes.
- Error messages are generic.
- Missing or malformed wallboard configuration disables local wallboard login
  and shows a clear configuration-unavailable message without exposing details.
- The existing Zoho sign-in remains available for approved staff.

The rate limiter uses a small Postgres table added through the existing
Supabase migration path so limits work across Vercel instances. It stores a
keyed hash of the normalized username and client address, not the raw password
or address. Successful login clears failures for that key, and expired records
are removed opportunistically.

## Components

- `wallboard credentials provider`: validates the environment-backed account
  and attaches the wallboard access level.
- `session access helpers`: distinguish staff access from wallboard-only access.
- `wallboard sign-in screen`: branded username/password form with generic
  errors.
- `route guards`: permit wallboard-only access only where explicitly required.
- `rate-limit store`: records and expires failed login attempts.

Each component has one responsibility and can be tested independently.

## Testing

Automated tests cover:

- valid wallboard credentials create wallboard access
- invalid username or password is rejected generically
- missing configuration disables local login
- wallboard sessions can render `/wallboard`
- wallboard sessions can read the live presence feed
- wallboard sessions are redirected away from `/dispatch`
- wallboard sessions cannot use write or integration endpoints
- approved Zoho staff still access both views
- unauthenticated wallboard users reach the local sign-in page
- rate limiting rejects repeated failures and clears after expiry

The full test suite, ESLint, and production build must pass. Production browser
verification covers login, persistent wallboard access, Dispatch denial, live
refresh, and sign out.

## Deployment

1. Generate a strong wallboard password and salted hash locally.
2. Add the username and hash to Vercel production environment settings.
3. Apply the wallboard login-attempt migration.
4. Deploy the tested build.
5. Sign in on the wallboard PC and verify the restricted session.

The plaintext password is provided directly to the administrator for the
wallboard PC and is not committed or written to project documentation.

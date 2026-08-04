import Link from "next/link";

import { CommandCentreLogo } from "@/app/components/command-centre-logo";
import { isWallboardLoginConfigured } from "@/server/auth/wallboard-login";

import { wallboardSignIn } from "./actions";
import { WallboardSubmitButton } from "./submit-button";

type WallboardSignInPageProps = {
  searchParams: Promise<{ error?: string | string[] }>;
};

export default async function WallboardSignInPage({
  searchParams,
}: WallboardSignInPageProps) {
  const { error } = await searchParams;
  const configured = isWallboardLoginConfigured();
  const showInvalidCredentials = error === "invalid";

  return (
    <main className="flex min-h-screen items-center justify-center bg-cc-canvas px-6 py-10 text-cc-text">
      <section className="w-full max-w-md rounded-lg border border-cc-border bg-cc-surface-1 p-6 shadow-2xl sm:p-7">
        <div className="flex items-center gap-3">
          <CommandCentreLogo
            className="h-14 w-14 shrink-0 object-contain"
            decorative
            priority
            variant="icon-colour"
          />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-cc-orange">
              Command Centre
            </p>
            <h1 className="mt-1 text-2xl font-semibold">Wallboard sign in</h1>
          </div>
        </div>

        <p className="mt-5 text-sm text-cc-text-secondary">
          Sign in to display the live Command Centre wallboard.
        </p>

        {showInvalidCredentials ? (
          <p
            className="mt-4 rounded-md border border-cc-red/35 bg-cc-red/10 px-3 py-2 text-sm text-red-100"
            role="alert"
          >
            Sign-in details were not accepted.
          </p>
        ) : null}

        {!configured ? (
          <p
            className="mt-4 rounded-md border border-cc-warning/35 bg-cc-warning/10 px-3 py-2 text-sm text-cc-text-secondary"
            role="status"
          >
            Local wallboard sign-in is unavailable. Contact an administrator to
            configure it.
          </p>
        ) : null}

        <form action={wallboardSignIn} className="mt-5 space-y-4">
          <div>
            <label className="text-sm font-semibold" htmlFor="wallboard-username">
              Username
            </label>
            <input
              autoComplete="username"
              className="mt-1.5 w-full rounded-md border border-cc-border-strong bg-cc-surface-2 px-3 py-2.5 text-sm text-cc-text placeholder:text-cc-text-muted disabled:cursor-not-allowed disabled:opacity-55"
              disabled={!configured}
              id="wallboard-username"
              name="username"
              required
              type="text"
            />
          </div>
          <div>
            <label className="text-sm font-semibold" htmlFor="wallboard-password">
              Password
            </label>
            <input
              autoComplete="current-password"
              className="mt-1.5 w-full rounded-md border border-cc-border-strong bg-cc-surface-2 px-3 py-2.5 text-sm text-cc-text placeholder:text-cc-text-muted disabled:cursor-not-allowed disabled:opacity-55"
              disabled={!configured}
              id="wallboard-password"
              name="password"
              required
              type="password"
            />
          </div>
          <WallboardSubmitButton configured={configured} />
        </form>

        <Link
          className="mt-5 inline-flex text-sm font-semibold text-cc-orange hover:underline"
          href="/auth/sign-in"
        >
          Staff sign in with Zoho
        </Link>
      </section>
    </main>
  );
}

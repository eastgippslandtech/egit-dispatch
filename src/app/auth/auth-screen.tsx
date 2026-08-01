import { Monitor, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { CommandCentreLogo } from "@/app/components/command-centre-logo";

export function CommandCentreSignIn() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-cc-canvas px-6 text-cc-text">
      <section className="w-full max-w-xl rounded-lg border border-cc-border bg-cc-surface-1 p-7 shadow-2xl">
        <CommandCentreLogo
          className="mx-auto h-72 w-auto max-w-full object-contain"
          priority
          variant="stacked-dark"
        />
        <h1 className="mt-1 text-2xl font-semibold">Sign in</h1>
        <p className="mt-3 text-sm text-cc-text-secondary">
          Use your EGIT Zoho account to continue.
        </p>
        <form
          action={async () => {
            "use server";

            const { signIn } = await import("@/auth");
            await signIn("zoho", { redirectTo: "/dispatch" });
          }}
          className="mt-5"
        >
          <button
            className="w-full rounded-md bg-cc-orange px-4 py-2.5 text-sm font-semibold text-cc-surface-1 transition hover:brightness-110 active:brightness-95"
            type="submit"
          >
            Sign in with Zoho
          </button>
        </form>
        <Link
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-cc-border-strong bg-cc-surface-2 px-4 py-2.5 text-sm font-semibold text-cc-text transition hover:border-cc-orange/60 hover:bg-cc-surface-3 active:brightness-95"
          href="/auth/wallboard-sign-in"
        >
          <Monitor className="h-4 w-4" aria-hidden="true" />
          Wallboard login
        </Link>
      </section>
    </main>
  );
}

export function AccessNotApproved({
  email,
  name,
}: {
  email?: string;
  name?: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-cc-canvas px-6 text-cc-text">
      <section className="w-full max-w-md rounded-lg border border-cc-red/35 bg-cc-surface-1 p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <CommandCentreLogo
            className="h-20 w-20 shrink-0 object-contain"
            decorative
            testId="access-denied-brand"
            variant="icon-colour"
          />
          <span className="rounded-md bg-cc-red/15 p-2 text-red-100">
            <ShieldAlert className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-cc-orange">
              Command Centre
            </p>
            <h1 className="mt-1 text-2xl font-semibold">Access not approved</h1>
          </div>
        </div>
        <p className="mt-5 text-sm text-cc-text-secondary">
          Your Zoho sign-in worked, but this account is not on the Command
          Centre allowlist.
        </p>
        {email ? (
          <p className="mt-4 rounded-md border border-cc-border bg-cc-surface-2 px-3 py-2 font-mono text-xs text-cc-text-secondary">
            {name ? `${name} / ` : ""}
            {email}
          </p>
        ) : null}
      </section>
    </main>
  );
}

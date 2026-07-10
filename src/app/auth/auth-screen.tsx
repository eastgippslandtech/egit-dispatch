import { ShieldAlert } from "lucide-react";
import Image from "next/image";

export function CommandCentreSignIn() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#07111f] px-6 text-slate-100">
      <section className="w-full max-w-xl rounded-lg border border-white/10 bg-[#0b1628] p-7 shadow-2xl">
        <Image
          alt="Command Centre"
          className="mx-auto h-80 w-80 object-contain"
          height={1254}
          priority
          src="/assets/command-centre-logo.png"
          width={1254}
        />
        <h1 className="mt-1 text-2xl font-semibold">Sign in</h1>
        <p className="mt-3 text-sm text-slate-300">
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
            className="w-full rounded-md bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-[#07111f]"
            type="submit"
          >
            Sign in with Zoho
          </button>
        </form>
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
    <main className="flex min-h-screen items-center justify-center bg-[#07111f] px-6 text-slate-100">
      <section className="w-full max-w-md rounded-lg border border-amber-300/20 bg-[#0b1628] p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <Image
            alt=""
            className="h-24 w-24 shrink-0 object-contain"
            height={1254}
            src="/assets/command-centre-logo.png"
            width={1254}
          />
          <span className="rounded-md bg-amber-300/15 p-2 text-amber-100">
            <ShieldAlert className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-100">
              Command Centre
            </p>
            <h1 className="mt-1 text-2xl font-semibold">Access not approved</h1>
          </div>
        </div>
        <p className="mt-5 text-sm text-slate-300">
          Your Zoho sign-in worked, but this account is not on the Command
          Centre allowlist.
        </p>
        {email ? (
          <p className="mt-4 rounded-md border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-slate-200">
            {name ? `${name} / ` : ""}
            {email}
          </p>
        ) : null}
      </section>
    </main>
  );
}

import { ArrowLeft, CheckCircle2, CircleOff, PhoneCall } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCommandCentreAccess, isApprovedStaffAccess } from "@/server/auth/session";
import { isAdminStaffEmail } from "@/server/staff/profiles";
import { readYeastarConfig, yeastarWebhookConfigured } from "@/server/yeastar/config";
import { getConfiguredYeastarRepository } from "@/server/yeastar/repository";
import { readZohoCrmConfig } from "@/server/zoho-crm/config";

export const dynamic = "force-dynamic";

export default async function YeastarSettingsPage() {
  const access = await getCommandCentreAccess();
  if (access.status === "unauthenticated") {
    redirect("/auth/sign-in?callbackUrl=/settings/integrations/yeastar");
  }
  if (!isApprovedStaffAccess(access) || !isAdminStaffEmail(access.email)) {
    redirect("/dispatch");
  }

  const checks = [
    ["Database", Boolean(getConfiguredYeastarRepository()), "Supabase call-reporting storage"],
    ["Yeastar API", Boolean(readYeastarConfig()), "PBX CDR and Yeastar AI transcript access"],
    ["Signed webhook", yeastarWebhookConfigured(), "Completed-call event 30012"],
    ["Zoho CRM", Boolean(readZohoCrmConfig()), "Contact-first caller matching"],
    ["Scheduled processing", Boolean(process.env.INTEGRATION_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim()), "Processing and reconciliation authorization"],
  ] as const;

  return (
    <main className="min-h-dvh bg-cc-canvas p-5 text-cc-text">
      <div className="mx-auto max-w-3xl">
        <Link className="mb-4 inline-flex items-center gap-2 text-sm text-slate-300" href="/calls">
          <ArrowLeft className="h-4 w-4" /> Calls
        </Link>
        <header className="mb-5">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase text-cc-orange">
            <PhoneCall className="h-4 w-4" /> Integration
          </div>
          <h1 className="text-2xl font-bold">Yeastar call reporting</h1>
          <p className="mt-1 text-sm text-slate-400">
            Server-only connection health. Secrets are managed in Vercel and are never shown here.
          </p>
        </header>
        <div className="space-y-2">
          {checks.map(([label, ready, detail]) => (
            <article
              key={label}
              className="flex items-center justify-between rounded-md border border-cc-border bg-cc-surface-1 p-4"
            >
              <div>
                <h2 className="font-semibold">{label}</h2>
                <p className="text-sm text-slate-400">{detail}</p>
              </div>
              <span className={`flex items-center gap-2 text-sm font-semibold ${ready ? "text-emerald-300" : "text-slate-400"}`}>
                {ready ? <CheckCircle2 className="h-5 w-5" /> : <CircleOff className="h-5 w-5" />}
                {ready ? "Configured" : "Not configured"}
              </span>
            </article>
          ))}
        </div>
        <div className="mt-4 rounded-md border border-amber-300/20 bg-amber-300/8 p-4 text-sm text-amber-50">
          Call reporting remains inactive until the Yeastar API application, signed webhook secret,
          Zoho CRM service OAuth client, and scheduler secret are present. Dispatch and Wallboard
          continue normally while any item is unavailable.
        </div>
      </div>
    </main>
  );
}

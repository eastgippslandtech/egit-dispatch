import { ArrowLeft, PhoneCall, Settings } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCommandCentreAccess, isApprovedStaffAccess } from "@/server/auth/session";
import { getConfiguredYeastarRepository } from "@/server/yeastar/repository";
import { formatTalkTime } from "@/server/yeastar/talk-time";
import { isAdminStaffEmail } from "@/server/staff/profiles";

export const dynamic = "force-dynamic";

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const access = await getCommandCentreAccess();
  if (access.status === "unauthenticated") redirect("/auth/sign-in?callbackUrl=/calls");
  if (!isApprovedStaffAccess(access)) redirect("/dispatch");
  const repository = getConfiguredYeastarRepository();
  const calls = repository ? await repository.listCalls() : [];
  const query = (await searchParams).q?.trim().toLowerCase() ?? "";
  const filtered = calls.filter((call) =>
    !query || JSON.stringify(call).toLowerCase().includes(query),
  );

  return (
    <main className="min-h-dvh bg-cc-canvas p-5 text-cc-text">
      <div className="mx-auto max-w-6xl">
        <header className="mb-5 flex items-center justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase text-cc-orange">
              <PhoneCall className="h-4 w-4" /> Yeastar
            </div>
            <h1 className="text-2xl font-bold">External calls</h1>
          </div>
          <div className="flex gap-2">
            {isAdminStaffEmail(access.email) ? (
              <Link className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:border-cc-orange/40 hover:bg-cc-orange/10" href="/settings/integrations/yeastar">
                <Settings className="h-4 w-4" /> Integration
              </Link>
            ) : null}
            <Link className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:border-cc-orange/40 hover:bg-cc-orange/10" href="/dispatch">
              <ArrowLeft className="h-4 w-4" /> Dispatch
            </Link>
          </div>
        </header>
        <form className="mb-4">
          <input
            aria-label="Search external calls"
            className="w-full rounded-md border border-white/10 bg-cc-surface-1 px-3 py-2 text-sm"
            defaultValue={query}
            name="q"
            placeholder="Search customer, phone, technician or transcript status"
          />
        </form>
        <div className="overflow-hidden rounded-md border border-cc-border bg-cc-surface-1">
          {filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">
              {repository ? "No matching external calls" : "Call reporting is not configured"}
            </p>
          ) : (
            <div className="divide-y divide-white/8">
              {filtered.map((call) => (
                <Link
                  key={String(call.id)}
                  className="grid grid-cols-[150px_1fr_160px_110px] items-center gap-3 px-4 py-3 hover:bg-white/[0.04]"
                  href={`/calls/${String(call.id)}`}
                >
                  <span className="text-sm text-slate-300">
                    {formatDateTime(call.startedAt)}
                  </span>
                  <span>
                    <strong className="block text-sm">
                      {String(call.customerName ?? call.externalNumber)}
                    </strong>
                    <span className="text-xs text-slate-400">
                      {String(call.direction)} · {String(call.technicians || "Unmapped")}
                    </span>
                  </span>
                  <span className="text-xs text-slate-300">
                    {String(call.transcriptStatus).replaceAll("_", " ")}
                  </span>
                  <strong className="text-right font-mono text-sm text-cyan-100">
                    {formatTalkTime(Number(call.connectedTalkSeconds ?? 0))}
                  </strong>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function formatDateTime(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Melbourne",
  }).format(date);
}

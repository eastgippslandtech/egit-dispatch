import { ArrowLeft, PhoneCall } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCommandCentreAccess, isApprovedStaffAccess } from "@/server/auth/session";
import { getConfiguredYeastarRepository } from "@/server/yeastar/repository";
import { formatTalkTime } from "@/server/yeastar/talk-time";

export const dynamic = "force-dynamic";

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ callId: string }>;
}) {
  const access = await getCommandCentreAccess();
  if (access.status === "unauthenticated") redirect("/auth/sign-in?callbackUrl=/calls");
  if (!isApprovedStaffAccess(access)) redirect("/dispatch");
  const repository = getConfiguredYeastarRepository();
  const call = repository ? await repository.getCall((await params).callId) : undefined;
  if (!call) notFound();
  const segments = Array.isArray(call.segments) ? call.segments : [];

  return (
    <main className="min-h-dvh bg-cc-canvas p-5 text-cc-text">
      <div className="mx-auto max-w-4xl">
        <Link className="mb-4 inline-flex items-center gap-2 text-sm text-slate-300" href="/calls">
          <ArrowLeft className="h-4 w-4" /> Calls
        </Link>
        <header className="mb-4 rounded-md border border-cc-border bg-cc-surface-1 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase text-cc-orange">
                <PhoneCall className="h-4 w-4" /> {String(call.direction)}
              </div>
              <h1 className="text-2xl font-bold">
                {String(call.matched_customer_name ?? call.external_number)}
              </h1>
              <p className="mt-1 text-sm text-slate-400">{String(call.external_number)}</p>
            </div>
            <strong className="font-mono text-xl text-cyan-100">
              {formatTalkTime(Number(call.connected_talk_seconds ?? 0))}
            </strong>
          </div>
        </header>
        <section className="grid gap-4 md:grid-cols-2">
          <Panel title="Call">
            <Detail label="Started" value={formatDateTime(call.started_at)} />
            <Detail label="Ended" value={formatDateTime(call.ended_at)} />
            <Detail label="Status" value={String(call.call_status)} />
            <Detail label="Transcript" value={String(call.transcript_status)} />
            <Detail label="Contact" value={String(call.matched_contact_name ?? "Unmatched")} />
          </Panel>
          <Panel title="Technician segments">
            {segments.length === 0 ? (
              <p className="text-sm text-slate-400">No mapped technician segment</p>
            ) : segments.map((segment, index) => {
              const value = segment as Record<string, unknown>;
              return (
                <Detail
                  key={index}
                  label={String(value.technician ?? value.extension)}
                  value={formatTalkTime(Number(value.talkSeconds ?? 0))}
                />
              );
            })}
          </Panel>
        </section>
        <section className="mt-4 space-y-4">
          <Panel title="Summary">
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">
              {String(call.summary ?? "Yeastar summary is not available yet.")}
            </p>
          </Panel>
          <Panel title="Transcript">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-slate-200">
              {String(call.transcript ?? "Yeastar transcript is not available yet.")}
            </pre>
          </Panel>
        </section>
      </div>
    </main>
  );
}

function Panel({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="rounded-md border border-cc-border bg-cc-surface-1 p-4">
      <h2 className="mb-3 text-sm font-bold uppercase text-slate-300">{title}</h2>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/5 py-2 text-sm last:border-0">
      <span className="text-slate-400">{label}</span><strong>{value}</strong>
    </div>
  );
}

function formatDateTime(value: unknown) {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Melbourne",
  }).format(new Date(String(value)));
}

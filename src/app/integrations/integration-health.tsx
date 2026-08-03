"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Clock3,
  KeyRound,
  RefreshCw,
  ServerOff,
} from "lucide-react";

import type {
  IntegrationConnector,
  IntegrationConnectorHealth,
  IntegrationConnectorHealthStatus,
} from "@/server/integrations/types";

export type IntegrationCounts = {
  pending: number;
  reviewRequired: number;
};

const connectorLabels: Record<IntegrationConnector, string> = {
  command_centre: "Command Centre",
  email: "Technician email",
  msp_central: "MSP Central Helpdesk",
  msp_endpoint: "MSP Central Endpoint",
  outlook: "Microsoft Outlook",
  push: "Technician push",
  zoho_crm: "Zoho CRM",
  zoho_survey: "Zoho Survey",
};

const stateLabels: Record<IntegrationConnectorHealthStatus, string> = {
  authentication_required: "Authentication required",
  degraded: "Degraded",
  healthy: "Connected",
  stale: "Stale",
  unavailable: "Unavailable",
  unknown: "Unknown",
};

const stateClasses: Record<IntegrationConnectorHealthStatus, string> = {
  authentication_required: "border-rose-300/30 bg-rose-400/10 text-rose-100",
  degraded: "border-amber-300/30 bg-amber-400/10 text-amber-100",
  healthy: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
  stale: "border-sky-300/25 bg-sky-400/10 text-sky-100",
  unavailable: "border-rose-300/30 bg-rose-400/10 text-rose-100",
  unknown: "border-slate-300/20 bg-slate-400/10 text-slate-300",
};

export function IntegrationHealth({
  connectors,
  counts,
}: {
  connectors: IntegrationConnectorHealth[];
  counts: IntegrationCounts;
}) {
  return (
    <section aria-labelledby="connector-health-title">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase text-cc-orange">Status</p>
          <h2 className="text-base font-semibold" id="connector-health-title">
            Connector health
          </h2>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold tabular-nums">
          <span className="rounded-md border border-sky-300/20 bg-sky-400/10 px-2 py-1 text-sky-100">
            {counts.pending} pending
          </span>
          <span className="rounded-md border border-amber-300/25 bg-amber-400/10 px-2 py-1 text-amber-100">
            {counts.reviewRequired} review required
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-white/10">
        <table className="w-full min-w-[920px] border-collapse text-left text-xs">
          <thead className="bg-white/[0.04] text-[10px] uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2 font-semibold">Connector</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Last read</th>
              <th className="px-3 py-2 font-semibold">Last write</th>
              <th className="px-3 py-2 font-semibold">Last checked</th>
              <th className="px-3 py-2 font-semibold">Recent safe error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.07]">
            {connectors.map((connector) => {
              const Icon = statusIcon(connector.status);
              return (
                <tr key={connector.connector} className="bg-cc-surface-1/60">
                  <td className="px-3 py-2.5 font-semibold text-slate-100">
                    {connectorLabels[connector.connector]}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-semibold ${stateClasses[connector.status]}`}
                      title={`Connector status: ${stateLabels[connector.status]}`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {stateLabels[connector.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-300">{formatTimestamp(connector.lastReadAt)}</td>
                  <td className="px-3 py-2.5 text-slate-300">{formatTimestamp(connector.lastWriteAt)}</td>
                  <td className="px-3 py-2.5 text-slate-400">{formatTimestamp(connector.lastCheckedAt)}</td>
                  <td className="max-w-[340px] truncate px-3 py-2.5 text-slate-400" title={connector.lastError}>
                    {connector.lastError ?? "None"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {connectors.length === 0 ? (
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-slate-400">
            <CircleHelp className="h-4 w-4" /> No connector activity has been recorded yet.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function statusIcon(status: IntegrationConnectorHealthStatus) {
  if (status === "healthy") return CheckCircle2;
  if (status === "authentication_required") return KeyRound;
  if (status === "unavailable") return ServerOff;
  if (status === "stale") return Clock3;
  if (status === "unknown") return CircleHelp;
  if (status === "degraded") return AlertTriangle;
  return RefreshCw;
}

export function formatTimestamp(value?: string) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "Australia/Melbourne",
  }).format(date);
}

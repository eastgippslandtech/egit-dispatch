"use client";

import { ExternalLink, RefreshCw, XCircle } from "lucide-react";
import Link from "next/link";

import type { IntegrationOperationState } from "@/server/integrations/types";

import { formatTimestamp } from "./integration-health";

export type FailedActionSummary = {
  actionType: string;
  actorEmail: string;
  attemptCount: number;
  createdAt: string;
  id: string;
  lastError?: string;
  requestId: string;
  state: IntegrationOperationState;
  updatedAt: string;
};

export function FailedActions({
  actions,
  busyAction,
  onCancel,
  onRetry,
}: {
  actions: FailedActionSummary[];
  busyAction?: {
    action: "cancel" | "retry";
    confirmedAbsent: boolean;
    operationId: string;
  };
  onCancel: (operationId: string) => void;
  onRetry: (operationId: string, confirmedAbsent?: boolean) => void;
}) {
  return (
    <section aria-labelledby="failed-actions-title">
      <div className="mb-2">
        <p className="text-[11px] font-semibold uppercase text-cc-orange">Recovery</p>
        <h2 className="text-base font-semibold" id="failed-actions-title">Failed actions</h2>
      </div>
      <div className="overflow-hidden rounded-md border border-white/10">
        {actions.length === 0 ? (
          <p className="px-4 py-7 text-center text-sm text-slate-400">
            No actions need attention.
          </p>
        ) : (
          <div className="divide-y divide-white/[0.07]">
            {actions.map((action) => {
              const busy = busyAction?.operationId === action.id;
              const retrying =
                busy && busyAction.action === "retry" && !busyAction.confirmedAbsent;
              const retryingConfirmedAbsent =
                busy && busyAction.action === "retry" && busyAction.confirmedAbsent;
              const cancelling = busy && busyAction.action === "cancel";
              return (
                <article
                  key={action.id}
                  className="grid gap-3 bg-cc-surface-1/60 px-3 py-3 lg:grid-cols-[minmax(190px,1fr)_minmax(260px,2fr)_auto] lg:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold text-slate-100">{actionLabel(action.actionType)}</p>
                      <span className={actionStateClass(action.state)}>{actionStateLabel(action.state)}</span>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-cc-orange">{action.requestId || "No request"}</p>
                  </div>
                  <div className="min-w-0 text-xs text-slate-400">
                    <p className="truncate text-slate-300" title={action.lastError}>{action.lastError ?? "Waiting for another attempt."}</p>
                    <p className="mt-1">Attempt {action.attemptCount} / {formatTimestamp(action.updatedAt)} / {action.actorEmail}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {action.requestId ? (
                      <Link
                        className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-cc-orange/35 hover:text-cc-orange"
                        href={`/dispatch?requestId=${encodeURIComponent(action.requestId)}`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> Open request
                      </Link>
                    ) : null}
                    {action.state === "review_required" ? (
                      <button
                        aria-busy={retrying}
                        className="inline-flex items-center gap-1.5 rounded-md border border-sky-300/20 bg-sky-400/10 px-2.5 py-1.5 text-xs font-semibold text-sky-100 disabled:opacity-50"
                        disabled={busy}
                        title="Retry this action after reviewing the provider error"
                        type="button"
                        onClick={() => onRetry(action.id, false)}
                      >
                        {retrying ? null : <RefreshCw className="h-3.5 w-3.5" />}
                        {retrying ? "Retrying..." : "Retry"}
                      </button>
                    ) : null}
                    {action.state === "review_required" ? (
                      <button
                        aria-busy={retryingConfirmedAbsent}
                        className="inline-flex items-center gap-1.5 rounded-md border border-amber-300/25 bg-amber-400/10 px-2.5 py-1.5 text-xs font-semibold text-amber-100 disabled:opacity-50"
                        disabled={busy}
                        title="Use only after confirming the provider has no matching record"
                        type="button"
                        onClick={() => {
                          if (window.confirm("Only continue if you verified in the provider that no matching record exists. Retry this write?")) {
                            onRetry(action.id, true);
                          }
                        }}
                      >
                        {retryingConfirmedAbsent ? null : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        {retryingConfirmedAbsent
                          ? "Retrying confirmed action..."
                          : "Confirm absent and retry"}
                      </button>
                    ) : null}
                    {action.state === "queued" || action.state === "review_required" || action.state === "retrying" ? (
                      <button
                        aria-busy={cancelling}
                        className="inline-flex items-center gap-1.5 rounded-md border border-rose-300/20 bg-rose-400/10 px-2.5 py-1.5 text-xs font-semibold text-rose-100 disabled:opacity-50"
                        disabled={busy}
                        title="Cancel this queued provider action"
                        type="button"
                        onClick={() => {
                          if (window.confirm("Cancel this integration action? Provider changes already completed cannot be undone.")) {
                            onCancel(action.id);
                          }
                        }}
                      >
                        {cancelling ? null : <XCircle className="h-3.5 w-3.5" />}
                        {cancelling ? "Cancelling..." : "Cancel"}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export function RecoveryAuditSummary({ actions }: { actions: FailedActionSummary[] }) {
  return (
    <section aria-labelledby="recovery-audit-title">
      <div className="mb-2">
        <p className="text-[11px] font-semibold uppercase text-cc-orange">Audit</p>
        <h2 className="text-base font-semibold" id="recovery-audit-title">Recent recovery activity</h2>
      </div>
      <div className="overflow-hidden rounded-md border border-white/10">
        {actions.length === 0 ? (
          <p className="px-4 py-5 text-sm text-slate-400">No recent recovery activity.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-white/[0.04] text-[10px] uppercase text-slate-400">
              <tr><th className="px-3 py-2">Action</th><th className="px-3 py-2">Request</th><th className="px-3 py-2">Initiated by</th><th className="px-3 py-2">Updated</th></tr>
            </thead>
            <tbody className="divide-y divide-white/[0.07]">
              {actions.slice(0, 5).map((action) => (
                <tr key={action.id}>
                  <td className="px-3 py-2 text-slate-200">{actionLabel(action.actionType)}</td>
                  <td className="px-3 py-2 font-mono text-cc-orange">{action.requestId || "-"}</td>
                  <td className="px-3 py-2 text-slate-400">{action.actorEmail}</td>
                  <td className="px-3 py-2 text-slate-400">{formatTimestamp(action.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function actionLabel(actionType: string) {
  const labels: Record<string, string> = {
    "helpdesk.communication": "Customer communication",
    "helpdesk.merge": "Request merge",
    "helpdesk.request.create": "Request creation",
    "helpdesk.worklog": "Work Log",
    "schedule.booking": "Schedule booking",
  };
  return labels[actionType] ?? actionType.replace(/[._-]+/g, " ");
}

function actionStateLabel(state: IntegrationOperationState) {
  const labels: Record<IntegrationOperationState, string> = {
    cancelled: "Cancelled",
    queued: "Queued",
    retrying: "Retrying",
    review_required: "Review required",
    synced: "Synced",
    syncing: "Syncing",
  };
  return labels[state];
}

function actionStateClass(state: IntegrationOperationState) {
  return `shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
    state === "review_required"
      ? "border-amber-300/25 bg-amber-400/10 text-amber-100"
      : "border-sky-300/20 bg-sky-400/10 text-sky-100"
  }`;
}

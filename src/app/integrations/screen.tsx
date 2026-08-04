"use client";

import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { CommandCentreLogo } from "@/app/components/command-centre-logo";
import type { IntegrationConnectorHealth } from "@/server/integrations/types";

import {
  FailedActions,
  type FailedActionSummary,
  RecoveryAuditSummary,
} from "./failed-actions";
import { IntegrationHealth, type IntegrationCounts } from "./integration-health";

type IntegrationSnapshot = {
  actions: FailedActionSummary[];
  connectors: IntegrationConnectorHealth[];
  counts: IntegrationCounts;
};

export function IntegrationsConsole() {
  const [snapshot, setSnapshot] = useState<IntegrationSnapshot>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busyAction, setBusyAction] = useState<{
    action: "cancel" | "retry";
    confirmedAbsent: boolean;
    operationId: string;
  }>();
  const mounted = useRef(true);
  const refreshSequence = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      refreshSequence.current += 1;
    };
  }, []);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const [healthResponse, actionsResponse] = await Promise.all([
        fetch("/api/internal/integrations/health", {
          cache: "no-store",
          headers: { Accept: "application/json" },
        }),
        fetch("/api/internal/integrations/actions", {
          cache: "no-store",
          headers: { Accept: "application/json" },
        }),
      ]);
      if ([401, 403].includes(healthResponse.status) || [401, 403].includes(actionsResponse.status)) {
        throw new Error("AUTHORIZATION_REQUIRED");
      }
      if (!healthResponse.ok || !actionsResponse.ok) {
        throw new Error("Integration status could not be loaded.");
      }
      const health = (await healthResponse.json()) as {
        connectors: IntegrationConnectorHealth[];
        counts: IntegrationCounts;
      };
      const actions = (await actionsResponse.json()) as {
        actions: FailedActionSummary[];
      };
      if (!mounted.current || sequence !== refreshSequence.current) return;
      setSnapshot({ ...health, actions: actions.actions });
      setError(undefined);
    } catch (loadError) {
      if (!mounted.current || sequence !== refreshSequence.current) return;
      setError(
        loadError instanceof Error && loadError.message === "AUTHORIZATION_REQUIRED"
          ? "Your session no longer has access to integration recovery."
          : "Integration status could not be loaded. Existing provider actions are still retained for recovery.",
      );
    }
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (active) await refresh();
    };
    void load();
    const interval = window.setInterval(load, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [refresh]);

  async function runAction(
    operationId: string,
    action: "cancel" | "retry",
    confirmedAbsent = false,
  ) {
    setBusyAction({ action, confirmedAbsent, operationId });
    setNotice(undefined);
    try {
      const response = await fetch(
        `/api/internal/integrations/actions/${encodeURIComponent(operationId)}/${action}`,
        {
          body: action === "retry" ? JSON.stringify({ confirmAbsent: confirmedAbsent }) : undefined,
          cache: "no-store",
          headers: action === "retry" ? { "Content-Type": "application/json" } : undefined,
          method: "POST",
        },
      );
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if ([401, 403].includes(response.status)) throw new Error("Your session no longer has access to integration recovery.");
      if (!response.ok) throw new Error(body?.error ?? `The action could not be ${action === "retry" ? "retried" : "cancelled"}.`);
      if (!mounted.current) return;
      setNotice(
        action === "retry"
          ? confirmedAbsent
            ? "Confirmed-absent retry queued. Syncing will continue in the background."
            : "Retry queued. Syncing will continue in the background."
          : "Action cancelled.",
      );
      await refresh();
    } catch (actionError) {
      if (!mounted.current) return;
      setError(actionError instanceof Error ? actionError.message : "The recovery action could not be completed.");
    } finally {
      if (mounted.current) setBusyAction(undefined);
    }
  }

  return (
    <main className="min-h-screen bg-cc-canvas text-slate-100" data-density="compact">
      <header className="border-b border-white/10 bg-cc-surface-1 px-4 py-2.5">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <CommandCentreLogo className="h-10 w-10 shrink-0 object-contain" variant="icon-colour" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase text-cc-orange">Command Centre</p>
              <h1 className="truncate text-lg font-semibold">Integrations</h1>
            </div>
          </div>
          <Link className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 hover:border-cc-orange/35 hover:text-cc-orange" href="/dispatch">
            <ArrowLeft className="h-4 w-4" /> Dispatch
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] gap-5 px-4 py-4">
        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-rose-300/25 bg-rose-400/10 px-3 py-2.5 text-sm text-rose-100" role="alert">
            <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {error}</span>
            <button className="inline-flex items-center gap-1.5 rounded-md border border-rose-200/20 px-2.5 py-1.5 text-xs font-semibold" type="button" onClick={() => void refresh()}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </div>
        ) : null}
        {notice ? <p className="rounded-md border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100" role="status">{notice}</p> : null}
        {!snapshot && !error ? (
          <div className="flex items-center gap-2 py-16 text-sm text-slate-400" role="status"><RefreshCw className="h-4 w-4 animate-spin" /> Loading integration status</div>
        ) : null}
        {snapshot ? (
          <>
            <IntegrationHealth connectors={snapshot.connectors} counts={snapshot.counts} />
            <FailedActions actions={snapshot.actions} busyAction={busyAction} onCancel={(id) => void runAction(id, "cancel")} onRetry={(id, confirmedAbsent) => void runAction(id, "retry", confirmedAbsent)} />
            <RecoveryAuditSummary actions={snapshot.actions} />
          </>
        ) : null}
      </div>
    </main>
  );
}

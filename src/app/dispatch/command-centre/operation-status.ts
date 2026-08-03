"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createElement } from "react";
import Link from "next/link";

import type {
  IntegrationConnectorHealthStatus,
  IntegrationOperationState,
} from "@/server/integrations/types";

export const operationPollingIntervalMs = 3_000;

export type TrackedIntegrationOperation = {
  appointmentId?: string;
  operationId: string;
  requestId?: string;
  state: IntegrationOperationState;
};

const pendingStates = new Set<IntegrationOperationState>([
  "queued",
  "retrying",
  "syncing",
]);

export function operationStateForRequest(
  operations: TrackedIntegrationOperation[],
  requestId?: string,
) {
  if (!requestId) return undefined;
  const states = operations
    .filter((operation) => operation.requestId === requestId)
    .map((operation) => operation.state);
  if (states.includes("review_required")) return "review_required" as const;
  return states.find((state) => pendingStates.has(state));
}

export function useTrackedIntegrationOperations({ hydrate = false } = {}) {
  const [operations, setOperations] = useState<TrackedIntegrationOperation[]>([]);
  const terminalOperationIds = useRef(new Set<string>());

  const track = useCallback((operation: TrackedIntegrationOperation) => {
    if (!operation.operationId) return;
    setOperations((current) => [
      ...current.filter((candidate) => candidate.operationId !== operation.operationId),
      operation,
    ]);
  }, []);

  useEffect(() => {
    if (!hydrate) return;
    let active = true;

    const hydrateActiveOperations = async () => {
      try {
        const response = await fetch(
          "/api/internal/integrations/actions?scope=active",
          { cache: "no-store", headers: { Accept: "application/json" } },
        );
        if ([401, 403].includes(response.status) || !response.ok) return;
        const body = (await response.json()) as {
          actions?: Array<{
            id?: string;
            requestId?: string;
            state?: IntegrationOperationState;
          }>;
        };
        if (!active) return;
        const hydrated = (body.actions ?? []).flatMap((operation) =>
          operation.id && operation.state && isActiveOperationState(operation.state)
            ? [{
                operationId: operation.id,
                requestId: operation.requestId,
                state: operation.state,
              }]
            : [],
        );
        setOperations((current) => {
          const localIds = new Set(current.map((operation) => operation.operationId));
          return [
            ...current,
            ...hydrated.filter(
              (operation) =>
                !localIds.has(operation.operationId) &&
                !terminalOperationIds.current.has(operation.operationId),
            ),
          ];
        });
      } catch {
        // A technician may not have access to the recovery list; Dispatch remains usable.
      }
    };

    void hydrateActiveOperations();
    return () => {
      active = false;
    };
  }, [hydrate]);

  const pendingOperationIds = useMemo(
    () =>
      operations
        .filter((operation) => pendingStates.has(operation.state))
        .map((operation) => operation.operationId),
    [operations],
  );

  useEffect(() => {
    if (pendingOperationIds.length === 0) return;
    let active = true;

    const poll = async () => {
      const updates = await Promise.all(
        pendingOperationIds.map(async (operationId) => {
          try {
            const response = await fetch(
              `/api/internal/integrations/actions/${encodeURIComponent(operationId)}`,
              { cache: "no-store", headers: { Accept: "application/json" } },
            );
            if (!response.ok) return undefined;
            const body = (await response.json()) as {
              operation?: { id: string; state: IntegrationOperationState };
            };
            return body.operation;
          } catch {
            return undefined;
          }
        }),
      );
      if (!active) return;
      for (const update of updates) {
        if (update && (update.state === "synced" || update.state === "cancelled")) {
          terminalOperationIds.current.add(update.id);
        }
      }
      setOperations((current) =>
        current.flatMap((operation) => {
          const update = updates.find((candidate) => candidate?.id === operation.operationId);
          if (!update) return [operation];
          if (update.state === "synced" || update.state === "cancelled") return [];
          return [{ ...operation, state: update.state }];
        }),
      );
    };

    const interval = window.setInterval(() => void poll(), operationPollingIntervalMs);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [pendingOperationIds]);

  return {
    operations,
    stateForAppointment: (appointmentId?: string) =>
      appointmentId
        ? operations.find((operation) => operation.appointmentId === appointmentId)?.state
        : undefined,
    stateForRequest: (requestId?: string) =>
      operationStateForRequest(operations, requestId),
    track,
  };
}

export function GlobalIntegrationStatus({
  localOperations,
  showRecoveryLink = true,
}: {
  localOperations: TrackedIntegrationOperation[];
  showRecoveryLink?: boolean;
}) {
  const [counts, setCounts] = useState<{ pending: number; reviewRequired: number }>();
  const [connectorStatus, setConnectorStatus] =
    useState<IntegrationConnectorHealthStatus>();
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/internal/integrations/health", {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("unavailable");
        const body = (await response.json()) as {
          connectors?: Array<{ status: IntegrationConnectorHealthStatus }>;
          counts?: { pending: number; reviewRequired: number };
        };
        if (!active) return;
        setCounts(body.counts ?? { pending: 0, reviewRequired: 0 });
        setConnectorStatus(highestConnectorStatus(body.connectors ?? []));
        setUnavailable(false);
      } catch {
        if (active) setUnavailable(true);
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const localPending = localOperations.filter((operation) => pendingStates.has(operation.state)).length;
  const localReview = localOperations.filter((operation) => operation.state === "review_required").length;
  const pending = Math.max(counts?.pending ?? 0, localPending);
  const reviewRequired = Math.max(counts?.reviewRequired ?? 0, localReview);
  const connectorUnavailable = connectorStatus === "unavailable";
  const authenticationRequired = connectorStatus === "authentication_required";
  const statusUnknown = connectorStatus === undefined || connectorStatus === "unknown";
  const label = reviewRequired > 0
      ? `${pending} syncing, ${reviewRequired} review required`
      : authenticationRequired
        ? "Integration authentication required"
      : connectorUnavailable || (unavailable && !counts)
        ? "Integrations unavailable"
      : pending > 0
        ? `${pending} syncing`
        : connectorStatus === "degraded"
          ? "Integrations degraded"
          : connectorStatus === "stale"
            ? "Integration data stale"
            : statusUnknown
              ? "Integration status not checked"
              : "Integrations connected";
  const className = reviewRequired > 0
    ? "border-amber-300/25 bg-amber-400/10 text-amber-100"
    : authenticationRequired || connectorUnavailable
      ? "border-rose-300/25 bg-rose-400/10 text-rose-100"
    : unavailable
      ? "border-slate-300/15 bg-slate-400/[0.06] text-slate-400"
      : pending > 0
        ? "border-sky-300/20 bg-sky-400/10 text-sky-100"
        : connectorStatus === "degraded"
          ? "border-amber-300/25 bg-amber-400/10 text-amber-100"
          : connectorStatus === "stale"
            ? "border-sky-300/20 bg-sky-400/10 text-sky-100"
            : statusUnknown
              ? "border-slate-300/15 bg-slate-400/[0.06] text-slate-400"
              : "border-emerald-300/20 bg-emerald-400/[0.08] text-emerald-100";

  const sharedProps = {
    "aria-label": label,
    className: `inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold ${className}`,
  };

  if (!showRecoveryLink) {
    return createElement("span", { ...sharedProps, title: "Integration status" }, label);
  }

  return createElement(
    Link,
    {
      ...sharedProps,
      href: "/integrations",
      title: "Open integration health and recovery",
    },
    label,
  );
}

function isActiveOperationState(state: IntegrationOperationState) {
  return pendingStates.has(state) || state === "review_required";
}

function highestConnectorStatus(
  connectors: Array<{ status: IntegrationConnectorHealthStatus }>,
) {
  const statuses = connectors.map((connector) => connector.status);
  if (statuses.includes("authentication_required")) return "authentication_required";
  if (statuses.includes("unavailable")) return "unavailable";
  if (statuses.includes("degraded")) return "degraded";
  if (statuses.includes("stale")) return "stale";
  if (statuses.includes("unknown")) return "unknown";
  return statuses.includes("healthy") ? "healthy" : undefined;
}

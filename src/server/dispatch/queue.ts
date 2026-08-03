import type { DispatchRequest } from "./types";

export type DispatchQueueView =
  | "new"
  | "mine"
  | "assigned"
  | "updated"
  | "waiting"
  | "sla-risk"
  | "failed-sync";

export const DISPATCH_QUEUE_VIEWS: Array<{
  key: DispatchQueueView;
  label: string;
}> = [
  { key: "new", label: "New / Unassigned" },
  { key: "mine", label: "My Queue" },
  { key: "assigned", label: "Assigned" },
  { key: "updated", label: "Updated" },
  { key: "waiting", label: "Waiting" },
  { key: "sla-risk", label: "SLA Risk" },
  { key: "failed-sync", label: "Failed Sync" },
];

export function requestMatchesDispatchQueue(
  request: DispatchRequest,
  view: DispatchQueueView,
  currentTechnicianId?: string,
  seenRequestIds: ReadonlySet<string> = new Set(),
) {
  if (request.status === "Resolved") return false;

  switch (view) {
    case "new":
      return !request.technicianId;
    case "mine":
      return Boolean(
        currentTechnicianId && request.technicianId === currentTechnicianId,
      );
    case "assigned":
      return Boolean(request.technicianId);
    case "updated":
      return hasUnreadRequestUpdate(request, seenRequestIds);
    case "waiting":
      return requestText(request).includes("waiting");
    case "sla-risk":
      return request.slaState !== "normal";
    case "failed-sync":
      return hasFailedSync(request);
  }
}

export function dispatchQueueCounts(
  requests: readonly DispatchRequest[],
  currentTechnicianId?: string,
  seenRequestIds: ReadonlySet<string> = new Set(),
) {
  return Object.fromEntries(
    DISPATCH_QUEUE_VIEWS.map(({ key }) => [
      key,
      requests.filter((request) =>
        requestMatchesDispatchQueue(
          request,
          key,
          currentTechnicianId,
          seenRequestIds,
        ),
      ).length,
    ]),
  ) as Record<DispatchQueueView, number>;
}

export function requestAttentionReason(
  request: DispatchRequest,
  seenRequestIds: ReadonlySet<string> = new Set(),
) {
  if (hasUnreadRequestUpdate(request, seenRequestIds)) {
    return request.updateInfo?.summary || "Request updated";
  }
  const failedWarning = request.warnings.find((warning) =>
    failedSyncText(warning),
  );
  if (failedWarning) return failedWarning;
  if (request.slaState === "overdue") return "SLA overdue";
  if (request.slaState === "due-soon") return "SLA due soon";
  if (!request.technicianId) return "Unassigned";
  const waitingWarning = request.warnings.find((warning) =>
    warning.toLowerCase().includes("waiting"),
  );
  if (waitingWarning) return waitingWarning;
  if (!request.category) return "Needs classification";
  return request.warnings[0] || "Assigned";
}

export function hasUnreadRequestUpdate(
  request: DispatchRequest,
  seenRequestIds: ReadonlySet<string>,
) {
  return Boolean(request.updateInfo && !seenRequestIds.has(request.id));
}

function hasFailedSync(request: DispatchRequest) {
  return request.warnings.some(failedSyncText);
}

function failedSyncText(value: string) {
  const normalized = value.toLowerCase();
  return (
    /sync|provider|calendar|outlook|msp central/.test(normalized) &&
    /fail|review|required|retry|unavailable|missing/.test(normalized)
  );
}

function requestText(request: DispatchRequest) {
  return [request.status, ...request.warnings].join(" ").toLowerCase();
}

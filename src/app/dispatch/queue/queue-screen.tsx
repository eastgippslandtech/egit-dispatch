"use client";

import {
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  GitMerge,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Plus,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";

import { CommandCentreLogo } from "@/app/components/command-centre-logo";
import {
  CreateRequestModal,
  MergeRequestModal,
  publishMspCentralRequestMerge,
  publishMspCentralWorklog,
  resolveWorkLogAppointment,
  TicketWorkspaceModal,
  WorkLogModal,
} from "@/app/dispatch/command-centre/prototype";
import { mockIsoTime } from "@/server/dispatch/date-scope";
import {
  DISPATCH_QUEUE_VIEWS,
  dispatchQueueCounts,
  hasUnreadRequestUpdate,
  requestAttentionReason,
  requestMatchesDispatchQueue,
  type DispatchQueueView,
} from "@/server/dispatch/queue";
import type {
  Appointment,
  DispatchDashboardData,
  DispatchRequest,
  Priority,
} from "@/server/dispatch/types";
import type {
  WorklogDisposition,
  WorklogForwardBooking,
  WorklogTransfer,
  WorklogType,
} from "@/server/worklogs/disposition";
import { roundWorklogMinutes } from "@/server/worklogs/time";

type WorkLogTarget = { appointmentId?: string; requestId: string };

const priorityOrder: Priority[] = ["Critical", "High", "Medium", "Low"];

export function DispatchQueueScreen({
  authDisabled,
  currentTechnicianId,
  data,
  showIntegrations,
}: {
  authDisabled: boolean;
  currentTechnicianId?: string;
  data: DispatchDashboardData;
  showIntegrations: boolean;
}) {
  const router = useRouter();
  const dashboard = data;
  const [view, setView] = useState<DispatchQueueView>("new");
  const [search, setSearch] = useState("");
  const [technicianId, setTechnicianId] = useState("all");
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [seenRequestIds, setSeenRequestIds] = useState<Set<string>>(new Set());
  const [selectedRequestId, setSelectedRequestId] = useState<string>();
  const [workspaceRequestId, setWorkspaceRequestId] = useState<string>();
  const [mergeRequestId, setMergeRequestId] = useState<string>();
  const [workLogTarget, setWorkLogTarget] = useState<WorkLogTarget>();
  const [createRequestOpen, setCreateRequestOpen] = useState(false);
  const [toast, setToast] = useState<string>();

  useEffect(() => {
    const refresh = () => router.refresh();
    const interval = window.setInterval(refresh, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(undefined), 3_500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const counts = useMemo(
    () => dispatchQueueCounts(dashboard.requests, currentTechnicianId, seenRequestIds),
    [currentTechnicianId, dashboard.requests, seenRequestIds],
  );
  const requests = useMemo(() => {
    const query = search.trim().toLowerCase();
    return dashboard.requests
      .filter((request) =>
        requestMatchesDispatchQueue(request, view, currentTechnicianId, seenRequestIds),
      )
      .filter((request) => technicianId === "all" || request.technicianId === technicianId)
      .filter((request) => priority === "all" || request.priority === priority)
      .filter((request) => !query || requestSearchText(request).includes(query))
      .sort(compareRequests);
  }, [
    currentTechnicianId,
    dashboard.requests,
    priority,
    search,
    seenRequestIds,
    technicianId,
    view,
  ]);
  const selectedRequest =
    dashboard.requests.find((request) => request.id === selectedRequestId) ?? requests[0];
  const workspaceRequest = dashboard.requests.find(
    (request) => request.id === workspaceRequestId,
  );
  const mergeRequest = dashboard.requests.find((request) => request.id === mergeRequestId);
  const workLogRequest = dashboard.requests.find(
    (request) => request.id === workLogTarget?.requestId,
  );
  const selectedAppointment = requestAppointments(
    dashboard.appointments,
    selectedRequest?.id,
  )[0];
  const liveWriteback = (request?: DispatchRequest) =>
    dashboard.dispatchDataSource === "msp-central" &&
    request?.sourceSystem === "msp-central";

  function openWorkspace(requestId: string) {
    setSelectedRequestId(requestId);
    setWorkspaceRequestId(requestId);
    setSeenRequestIds((current) => new Set(current).add(requestId));
  }

  function scheduleRequest(requestId: string) {
    router.push(`/dispatch?requestId=${encodeURIComponent(requestId)}`);
  }

  async function mergeInto(parentRequestId: string, idempotencyKey: string) {
    if (!mergeRequest) return;
    const result = await publishMspCentralRequestMerge({
      childRequestId: mergeRequest.id,
      idempotencyKey,
      parentRequestId,
    });
    setMergeRequestId(undefined);
    setToast(
      result.status === "review_required"
        ? "Merge queued, but provider sync needs review."
        : "Merge queued in MSP Central.",
    );
    router.refresh();
  }

  async function saveWorkLog({
    booking,
    disposition,
    idempotencyKey,
    minutes,
    notes,
    solution,
    transfer,
    workType,
  }: {
    billable: boolean;
    booking?: WorklogForwardBooking;
    disposition?: WorklogDisposition;
    idempotencyKey: string;
    minutes: string;
    notes: string;
    solution?: string;
    transfer?: WorklogTransfer;
    workType: WorklogType;
  }) {
    if (!workLogTarget || !workLogRequest) return;
    const description = notes.trim();
    const durationMinutes = roundWorklogMinutes(Number(minutes));
    if (!description || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      setToast(description ? "Work Log time must be greater than zero." : "Work Log notes are required.");
      return;
    }
    const appointment = resolveWorkLogAppointment(
      dashboard.appointments,
      workLogTarget.appointmentId,
    );
    const scheduled = Boolean(appointment || workLogRequest.scheduledStart);
    if (scheduled && !disposition) {
      setToast("Choose what happens to this scheduled job after saving.");
      return;
    }
    if (!liveWriteback(workLogRequest)) {
      setWorkLogTarget(undefined);
      setToast("Work Log captured in this test session.");
      return;
    }
    const endedAt = appointment?.date
      ? mockIsoTime(appointment.date, appointment.end)
      : new Date().toISOString();
    const startedAt = appointment?.date
      ? mockIsoTime(appointment.date, appointment.start)
      : new Date(new Date(endedAt).getTime() - durationMinutes * 60_000).toISOString();
    try {
      const result = await publishMspCentralWorklog({
        booking,
        currentBooking: appointment
          ? {
              eventId: appointment.outlookEventId,
              technicianId: appointment.technicianId,
              userPrincipalName: appointment.calendarOwnerEmail,
            }
          : undefined,
        description,
        disposition,
        durationMinutes,
        endedAt,
        idempotencyKey,
        requestId: workLogRequest.id,
        scheduled,
        solution,
        startedAt,
        transfer,
        visibility: workType === "internal" ? "internal" : "external",
        workType,
      });
      setWorkLogTarget(undefined);
      setToast(
        result.status === "review_required"
          ? "Work Log saved locally. Provider sync needs review."
          : "Work Log queued in MSP Central.",
      );
      router.refresh();
    } catch (error) {
      setToast(error instanceof Error ? `Work Log did not save: ${error.message}` : "Work Log did not save.");
    }
  }

  return (
    <main className="flex h-screen min-h-[680px] flex-col overflow-hidden bg-[#071423] text-slate-100">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-cc-border bg-cc-surface-1 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <CommandCentreLogo className="h-11 w-11 object-contain" decorative priority variant="icon-colour" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">Dispatch Queue</h1>
              <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                Connected
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">Operational inbox · {dashboard.timezone}</p>
          </div>
        </div>
        <nav className="flex flex-wrap items-center gap-1.5" aria-label="Command Centre navigation">
          <Link className={headerButtonClass} href="/dispatch">
            <LayoutDashboard className="h-4 w-4" /> Dispatch Board
          </Link>
          {showIntegrations ? (
            <Link className={headerButtonClass} href="/integrations">
              <CheckCircle2 className="h-4 w-4" /> Integrations
            </Link>
          ) : null}
          {authDisabled ? null : (
            <button className={headerButtonClass} type="button" onClick={() => signOut({ callbackUrl: "/auth/sign-in" })}>
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          )}
        </nav>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[210px_minmax(520px,1fr)_340px] gap-2 p-2 max-2xl:grid-cols-[190px_minmax(460px,1fr)]">
        <aside className="min-h-0 overflow-y-auto rounded-md border border-cc-border bg-cc-surface-1 p-2">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-[10px] font-bold uppercase text-cc-orange">Queues</p>
            <button aria-label="Create request" className="rounded-md bg-cc-orange p-1.5 text-cc-surface-1" type="button" onClick={() => setCreateRequestOpen(true)}>
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-1">
            {DISPATCH_QUEUE_VIEWS.map((item) => (
              <button
                key={item.key}
                aria-pressed={view === item.key}
                className={`flex items-center justify-between rounded-md border px-2.5 py-2 text-left text-sm font-semibold ${
                  view === item.key
                    ? "border-cc-orange/40 bg-cc-orange/15 text-cc-orange"
                    : "border-transparent text-slate-300 hover:border-white/10 hover:bg-white/5"
                }`}
                type="button"
                onClick={() => setView(item.key)}
              >
                <span>{item.label}</span>
                <span className="rounded-full bg-black/20 px-2 py-0.5 text-xs tabular-nums">{counts[item.key]}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-cc-border bg-cc-surface-1">
          <div className="shrink-0 border-b border-cc-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-400">Dispatch</p>
                <h2 className="text-lg font-semibold">{queueLabel(view)}</h2>
              </div>
              <span className="text-xs text-slate-400">{requests.length} requests</span>
            </div>
            <div className="mt-2 grid grid-cols-[minmax(220px,1fr)_180px_150px_auto] gap-2">
              <label className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-slate-400 focus-within:border-cc-orange/40">
                <Search className="h-4 w-4" />
                <input
                  className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  placeholder="Search requests"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <select aria-label="Technician filter" className={selectClass} value={technicianId} onChange={(event) => setTechnicianId(event.target.value)}>
                <option value="all">All technicians</option>
                {dashboard.technicians.map((technician) => (
                  <option key={technician.id} value={technician.id}>{technician.displayName}</option>
                ))}
              </select>
              <select aria-label="Priority filter" className={selectClass} value={priority} onChange={(event) => setPriority(event.target.value as Priority | "all")}>
                <option value="all">All priorities</option>
                {priorityOrder.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              {search || technicianId !== "all" || priority !== "all" ? (
                <button className={headerButtonClass} type="button" onClick={() => { setSearch(""); setTechnicianId("all"); setPriority("all"); }}>
                  <X className="h-4 w-4" /> Clear
                </button>
              ) : null}
            </div>
          </div>

          <div className="grid shrink-0 grid-cols-[minmax(260px,1.7fr)_130px_120px_160px_210px] gap-3 border-b border-cc-border bg-black/10 px-3 py-2 text-[10px] font-bold uppercase text-slate-500">
            <span>Request</span><span>Customer</span><span>Owner</span><span>Attention</span><span>Actions</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {requests.length === 0 ? (
              <div className="grid h-40 place-items-center text-sm text-slate-400">No requests in this queue</div>
            ) : requests.map((request) => (
              <RequestRow
                key={request.id}
                attention={requestAttentionReason(request, seenRequestIds)}
                isSelected={selectedRequest?.id === request.id}
                request={request}
                technicianName={technicianName(dashboard, request.technicianId)}
                unread={hasUnreadRequestUpdate(request, seenRequestIds)}
                onMerge={() => setMergeRequestId(request.id)}
                onOpen={() => openWorkspace(request.id)}
                onSchedule={() => scheduleRequest(request.id)}
                onSelect={() => setSelectedRequestId(request.id)}
              />
            ))}
          </div>
        </section>

        <RequestPreview
          appointment={selectedAppointment}
          dashboard={dashboard}
          request={selectedRequest}
          onMerge={() => selectedRequest && setMergeRequestId(selectedRequest.id)}
          onOpen={() => selectedRequest && openWorkspace(selectedRequest.id)}
          onSchedule={() => selectedRequest && scheduleRequest(selectedRequest.id)}
          onWorkLog={() => selectedRequest && setWorkLogTarget({ requestId: selectedRequest.id, appointmentId: selectedAppointment?.id })}
        />
      </div>

      {workspaceRequest ? (
        <TicketWorkspaceModal
          appointments={requestAppointments(dashboard.appointments, workspaceRequest.id)}
          liveWriteback={liveWriteback(workspaceRequest)}
          request={workspaceRequest}
          onClose={() => setWorkspaceRequestId(undefined)}
          onOpenWorkLog={(requestId, appointmentId) => {
            setWorkspaceRequestId(undefined);
            setWorkLogTarget({ requestId, appointmentId });
          }}
          onSchedule={scheduleRequest}
          onSaved={() => {
            setWorkspaceRequestId(undefined);
            setToast("Communication queued in MSP Central.");
            router.refresh();
          }}
        />
      ) : null}
      {workLogTarget && workLogRequest ? (
        <WorkLogModal
          appointment={resolveWorkLogAppointment(dashboard.appointments, workLogTarget.appointmentId)}
          liveWriteback={liveWriteback(workLogRequest)}
          request={workLogRequest}
          technician={technicianName(dashboard, workLogRequest.technicianId)}
          technicians={dashboard.technicians}
          onCancel={() => setWorkLogTarget(undefined)}
          onSave={saveWorkLog}
        />
      ) : null}
      {mergeRequest ? (
        <MergeRequestModal childRequest={mergeRequest} requests={dashboard.requests} onCancel={() => setMergeRequestId(undefined)} onConfirm={mergeInto} />
      ) : null}
      {createRequestOpen ? (
        <CreateRequestModal
          onCancel={() => setCreateRequestOpen(false)}
          onCreated={() => {
            setCreateRequestOpen(false);
            setToast("Request queued in MSP Central.");
            router.refresh();
          }}
        />
      ) : null}
      {toast ? (
        <div className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 rounded-md border border-emerald-300/25 bg-[#0d3d38] px-4 py-2.5 text-sm font-semibold text-emerald-50 shadow-xl" role="status">
          {toast}
        </div>
      ) : null}
    </main>
  );
}

function RequestRow({
  attention,
  isSelected,
  onMerge,
  onOpen,
  onSchedule,
  onSelect,
  request,
  technicianName: owner,
  unread,
}: {
  attention: string;
  isSelected: boolean;
  onMerge: () => void;
  onOpen: () => void;
  onSchedule: () => void;
  onSelect: () => void;
  request: DispatchRequest;
  technicianName: string;
  unread: boolean;
}) {
  return (
    <article
      aria-label={`${request.requestNumber} ${request.subject}`}
      className={`grid grid-cols-[minmax(260px,1.7fr)_130px_120px_160px_210px] gap-3 border-b border-white/[0.06] px-3 py-2.5 text-sm transition ${
        isSelected ? "bg-cc-orange/[0.08] shadow-[inset_3px_0_0_#ff7a2f]" : "hover:bg-white/[0.035]"
      }`}
      onClick={onSelect}
      onDoubleClick={onOpen}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-cc-orange">{request.requestNumber}</span>
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${priorityClass(request.priority)}`}>{request.priority}</span>
          {unread ? <span className="rounded-full bg-sky-400 px-1.5 py-0.5 text-[9px] font-bold text-[#071423]">UPDATED</span> : null}
        </div>
        <p className="mt-1 truncate font-semibold text-slate-100">{request.subject}</p>
        <p className="mt-0.5 truncate text-xs text-slate-400">{request.requester}</p>
      </div>
      <div className="min-w-0 self-center">
        <p className="truncate font-semibold">{request.customer}</p>
        <p className="truncate text-xs text-slate-400">{request.site}</p>
      </div>
      <div className="self-center text-xs font-semibold text-slate-300">{owner}</div>
      <div className="self-center">
        <p className="line-clamp-2 text-xs font-semibold text-amber-100">{attention}</p>
        <p className="mt-1 text-[10px] uppercase text-slate-500">{request.status}</p>
      </div>
      <div
        className="flex items-center justify-end gap-1 self-center"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <button className={rowActionClass} type="button" onClick={onOpen}><MessageSquare className="h-3.5 w-3.5" /> Open workspace</button>
        <button aria-label="Schedule" className={iconActionClass} title="Schedule" type="button" onClick={onSchedule}><CalendarDays className="h-4 w-4" /></button>
        <button aria-label="Merge request" className={iconActionClass} title="Merge request" type="button" onClick={onMerge}><GitMerge className="h-4 w-4" /></button>
      </div>
    </article>
  );
}

function RequestPreview({
  appointment,
  dashboard,
  onMerge,
  onOpen,
  onSchedule,
  onWorkLog,
  request,
}: {
  appointment?: Appointment;
  dashboard: DispatchDashboardData;
  onMerge: () => void;
  onOpen: () => void;
  onSchedule: () => void;
  onWorkLog: () => void;
  request?: DispatchRequest;
}) {
  return (
    <aside className="min-h-0 overflow-y-auto rounded-md border border-cc-border bg-cc-surface-1 p-3 max-2xl:hidden">
      <p className="text-[10px] font-bold uppercase text-cc-orange">Request</p>
      {!request ? <p className="mt-8 text-center text-sm text-slate-400">Select a request</p> : (
        <>
          <p className="mt-2 font-mono text-xs text-cc-orange">{request.requestNumber}</p>
          <h2 className="mt-1 text-lg font-semibold leading-6">{request.subject}</h2>
          <div className="mt-3 h-1 rounded-full bg-gradient-to-r from-cc-orange via-cc-orange to-transparent" />
          <div className="mt-4 grid gap-3 rounded-md border border-white/10 bg-white/[0.025] p-3 text-sm">
            <PreviewDetail label="Customer" value={request.customer} />
            <PreviewDetail label="Site" value={request.siteAddress || request.site} />
            <PreviewDetail label="Contact" value={`${request.requester} · ${request.contact}`} />
            <PreviewDetail label="Status" value={request.status} />
            <PreviewDetail label="Owner" value={technicianName(dashboard, request.technicianId)} />
            <PreviewDetail label="Attention" value={requestAttentionReason(request)} />
          </div>
          <div className="mt-4 grid gap-2">
            <button className={primaryActionClass} type="button" onClick={onOpen}><MessageSquare className="h-4 w-4" /> Open workspace</button>
            <button className={secondaryActionClass} type="button" onClick={onSchedule}><CalendarDays className="h-4 w-4" /> {appointment ? "Reschedule" : "Schedule"}</button>
            <button className={secondaryActionClass} type="button" onClick={onWorkLog}>Work Log</button>
            <button className={secondaryActionClass} type="button" onClick={onMerge}><GitMerge className="h-4 w-4" /> Merge</button>
            {request.helpdeskUrl ? <a className={secondaryActionClass} href={request.helpdeskUrl} rel="noreferrer" target="_blank"><ExternalLink className="h-4 w-4" /> Open in Helpdesk</a> : null}
          </div>
        </>
      )}
    </aside>
  );
}

function PreviewDetail({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[82px_1fr] gap-2"><span className="text-xs text-slate-400">{label}</span><span className="text-xs font-semibold text-slate-100">{value}</span></div>;
}

function requestAppointments(appointments: Appointment[], requestId?: string) {
  return requestId ? appointments.filter((appointment) => appointment.requestId === requestId) : [];
}

function requestSearchText(request: DispatchRequest) {
  return [request.requestNumber, request.subject, request.customer, request.site, request.requester, request.contact, request.status, request.priority, request.notes, request.category, request.subcategory, request.item, ...request.warnings]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function compareRequests(first: DispatchRequest, second: DispatchRequest) {
  const priorityDifference = priorityOrder.indexOf(first.priority) - priorityOrder.indexOf(second.priority);
  return priorityDifference || new Date(first.dueAt).getTime() - new Date(second.dueAt).getTime();
}

function technicianName(data: DispatchDashboardData, technicianId?: string) {
  return data.technicians.find((technician) => technician.id === technicianId)?.displayName ?? "Unassigned";
}

function queueLabel(view: DispatchQueueView) {
  return DISPATCH_QUEUE_VIEWS.find((item) => item.key === view)?.label ?? "Dispatch Queue";
}

function priorityClass(priority: Priority) {
  return priority === "Critical" ? "bg-rose-400/20 text-rose-100" : priority === "High" ? "bg-amber-300/20 text-amber-100" : priority === "Medium" ? "bg-emerald-300/15 text-emerald-100" : "bg-sky-300/15 text-sky-100";
}

const headerButtonClass = "inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-sm font-semibold text-slate-200 hover:border-cc-orange/40 hover:bg-cc-orange/10";
const selectClass = "rounded-md border border-white/10 bg-[#111d30] px-2.5 py-2 text-sm text-slate-100";
const rowActionClass = "inline-flex items-center gap-1 rounded-md border border-cc-orange/30 bg-cc-orange/10 px-2 py-1.5 text-xs font-semibold text-cc-orange hover:bg-cc-orange/20";
const iconActionClass = "rounded-md border border-white/10 bg-white/5 p-1.5 text-slate-300 hover:border-cc-orange/30 hover:text-cc-orange";
const primaryActionClass = "inline-flex items-center justify-center gap-2 rounded-md bg-cc-orange px-3 py-2 text-sm font-semibold text-cc-surface-1";
const secondaryActionClass = "inline-flex items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-cc-orange/30";

"use client";

import {
  Building2,
  CalendarDays,
  CarFront,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coffee,
  LayoutDashboard,
  LogOut,
  Palmtree,
  TriangleAlert,
  UserRound,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";

import { CommandCentreLogo } from "@/app/components/command-centre-logo";
import { ReadOnlyDispatchCalendar } from "@/app/dispatch/command-centre/prototype";
import {
  addDaysToDateKey,
  formatSelectedDateLabel,
  todayDateKey,
  type ViewMode,
} from "@/server/dispatch/date-scope";
import type {
  PresenceStatus,
  TechnicianPresence,
  WallboardSnapshot,
} from "@/server/presence/types";

const STATUS_STYLE: Record<PresenceStatus, string> = {
  driving: "border-sky-300/45 bg-sky-400/12 text-sky-100",
  in_office: "border-emerald-300/35 bg-emerald-400/10 text-emerald-100",
  leave: "border-violet-300/40 bg-violet-400/12 text-violet-100",
  lunch: "border-amber-300/45 bg-amber-400/12 text-amber-100",
  meeting: "border-cyan-300/40 bg-cyan-400/10 text-cyan-100",
  on_site: "border-cc-orange/55 bg-cc-orange/12 text-orange-50",
  personal: "border-fuchsia-300/35 bg-fuchsia-400/10 text-fuchsia-100",
};

export function WallboardScreen({
  authDisabled = false,
  canAccessDispatch,
  initialSnapshot,
}: {
  authDisabled?: boolean;
  canAccessDispatch: boolean;
  initialSnapshot: WallboardSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selectedDateKey, setSelectedDateKey] = useState(() => todayDateKey());
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [now, setNow] = useState(() => new Date());
  const [refreshDelayed, setRefreshDelayed] = useState(false);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    let stopped = false;

    async function refresh() {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/internal/presence", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Wallboard refresh failed.");
        const next = (await response.json()) as WallboardSnapshot;
        if (!stopped) {
          setSnapshot(next);
          setRefreshDelayed(false);
        }
      } catch {
        if (!stopped) setRefreshDelayed(true);
      }
    }

    const interval = window.setInterval(refresh, 30_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const presences = useMemo(
    () =>
      snapshot.dashboard.technicians.map((technician) => ({
        presence:
          snapshot.presences.find(
            (candidate) => candidate.technicianId === technician.id,
          ) ?? fallbackPresence(technician.id, technician.storeLocation),
        technician,
      })),
    [snapshot],
  );
  const selectedDateLabel = formatSelectedDateLabel(selectedDateKey);

  return (
    <main
      className="h-dvh overflow-hidden bg-cc-canvas text-cc-text"
      data-density="compact"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="shrink-0 border-b border-cc-border bg-cc-surface-1 px-4 py-2">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CommandCentreLogo
                className="h-12 w-12 object-contain"
                decorative
                priority
                variant="icon-colour"
              />
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold tracking-tight">
                    Command Centre Wallboard
                  </h1>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      refreshDelayed
                        ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
                        : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                    }`}
                  >
                    {refreshDelayed ? "Update delayed" : "Live"}
                  </span>
                  {snapshot.peopleStatus !== "connected" ? (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-400">
                      Leave: manual/Outlook
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-300">
                  <CalendarDays className="h-3.5 w-3.5 text-cc-orange" />
                  <span className="font-semibold text-slate-100">
                    {selectedDateLabel}
                  </span>
                  <span>Australia/Melbourne</span>
                  <span className="text-slate-500">
                    Updated {formatClock(snapshot.updatedAt)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex rounded-md border border-white/10 bg-white/5 p-1">
                {(["day", "week"] as const).map((mode) => (
                  <button
                    key={mode}
                    aria-label={mode}
                    aria-pressed={viewMode === mode}
                    className={`rounded px-2.5 py-1 text-sm font-semibold capitalize ${
                      viewMode === mode
                        ? "bg-cc-orange text-cc-surface-1"
                        : "text-slate-300"
                    }`}
                    type="button"
                    onClick={() => setViewMode(mode)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <button
                aria-label="Previous day"
                className="rounded-md border border-white/10 bg-white/5 p-2 text-slate-200"
                type="button"
                onClick={() =>
                  setSelectedDateKey((current) =>
                    addDaysToDateKey(current, viewMode === "week" ? -7 : -1),
                  )
                }
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                className="rounded-md border border-cc-orange/30 bg-cc-orange/10 px-3 py-1.5 text-sm font-semibold text-cc-orange"
                type="button"
                onClick={() => setSelectedDateKey(todayDateKey())}
              >
                Today
              </button>
              <button
                aria-label="Next day"
                className="rounded-md border border-white/10 bg-white/5 p-2 text-slate-200"
                type="button"
                onClick={() =>
                  setSelectedDateKey((current) =>
                    addDaysToDateKey(current, viewMode === "week" ? 7 : 1),
                  )
                }
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <input
                aria-label="Select wallboard date"
                className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm font-semibold [color-scheme:dark]"
                type="date"
                value={selectedDateKey}
                onChange={(event) => setSelectedDateKey(event.target.value)}
              />
              {canAccessDispatch ? (
                <Link
                  className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm font-semibold text-slate-200 hover:border-cc-orange/40 hover:bg-cc-orange/10"
                  href="/dispatch"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  Dispatch
                </Link>
              ) : null}
              {authDisabled ? null : (
                <button
                  aria-label="Sign out"
                  className="rounded-md border border-white/10 bg-white/5 p-2 text-slate-200"
                  type="button"
                  onClick={() =>
                    signOut({
                      callbackUrl: canAccessDispatch
                        ? "/auth/sign-in"
                        : "/auth/wallboard-sign-in",
                    })
                  }
                >
                  <LogOut className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </header>

        <section className="shrink-0 px-3 py-2">
          <div className="mb-1 flex items-center gap-2">
            <UsersRound className="h-4 w-4 text-cc-orange" />
            <h2 className="text-sm font-semibold">Team status</h2>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {presences.map(({ presence, technician }) => (
              <article
                key={technician.id}
                className={`min-w-0 rounded-md border px-3 py-2 ${STATUS_STYLE[presence.status]}`}
                data-testid={`presence-${technician.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <PresenceIcon status={presence.status} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">
                        {technician.displayName}
                      </div>
                      <div className="text-[10px] text-current/70">
                        {technician.baseOfficeName ?? technician.storeLocation}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-bold">{presence.label}</div>
                    {remainingLabel(presence, now) ? (
                      <div className="font-mono text-[10px] text-current/80">
                        {remainingLabel(presence, now)}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-current/15 pt-1.5">
                  <p className="truncate text-xs font-medium">{presence.context}</p>
                  {presence.conflicts.length > 0 ? (
                    <span
                      className="flex shrink-0 items-center gap-1 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-100"
                      title={`Also active: ${presence.conflicts.join(", ")}`}
                    >
                      <TriangleAlert className="h-3 w-3" />
                      Conflict
                    </span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className="flex min-h-0 flex-1 px-3 pb-3">
          <ReadOnlyDispatchCalendar
            data={snapshot.dashboard}
            dateKey={selectedDateKey}
            now={now}
            viewMode={viewMode}
          />
        </div>
      </div>
    </main>
  );
}

function PresenceIcon({ status }: { status: PresenceStatus }) {
  const className = "h-5 w-5 shrink-0";
  if (status === "driving") return <CarFront className={className} />;
  if (status === "on_site") return <UserRound className={className} />;
  if (status === "lunch") return <Coffee className={className} />;
  if (status === "leave") return <Palmtree className={className} />;
  if (status === "meeting") return <UsersRound className={className} />;
  if (status === "personal") return <Clock3 className={className} />;
  return <Building2 className={className} />;
}

function fallbackPresence(
  technicianId: string,
  office: string,
): TechnicianPresence {
  return {
    conflicts: [],
    context: office,
    label: "In office",
    source: "schedule",
    status: "in_office",
    technicianId,
  };
}

function remainingLabel(presence: TechnicianPresence, now: Date) {
  if (!presence.endsAt) return "";
  const minutes = Math.max(
    0,
    Math.ceil((new Date(presence.endsAt).getTime() - now.getTime()) / 60_000),
  );
  return minutes > 0 ? `${minutes}m remaining` : "";
}

function formatClock(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Australia/Melbourne",
  }).format(new Date(value));
}

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
  Moon,
  Palmtree,
  TriangleAlert,
  UserRound,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useEffect, useMemo, useRef, useState } from "react";

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

import { getWallboardDateAfterRefresh } from "./auto-advance";

const STATUS_STYLE: Record<PresenceStatus, string> = {
  closed: "border-slate-400/80 bg-slate-700/75 text-slate-50",
  driving: "border-sky-300/85 bg-sky-500/35 text-sky-50",
  in_office: "border-emerald-300/80 bg-emerald-500/35 text-emerald-50",
  leave: "border-violet-300/80 bg-violet-500/35 text-violet-50",
  lunch: "border-amber-300/85 bg-amber-500/35 text-amber-50",
  meeting: "border-indigo-300/80 bg-indigo-500/35 text-indigo-50",
  on_site: "border-orange-300/90 bg-orange-500/40 text-orange-50",
  personal: "border-fuchsia-300/80 bg-fuchsia-500/35 text-fuchsia-50",
};

const STATUS_ICON_STYLE: Record<PresenceStatus, string> = {
  closed: "bg-slate-300 text-slate-950 ring-slate-100/80",
  driving: "bg-sky-200 text-sky-950 ring-sky-50/80",
  in_office: "bg-emerald-200 text-emerald-950 ring-emerald-50/80",
  leave: "bg-violet-200 text-violet-950 ring-violet-50/80",
  lunch: "bg-amber-200 text-amber-950 ring-amber-50/80",
  meeting: "bg-indigo-200 text-indigo-950 ring-indigo-50/80",
  on_site: "bg-orange-200 text-orange-950 ring-orange-50/80",
  personal: "bg-fuchsia-200 text-fuchsia-950 ring-fuchsia-50/80",
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
  const lastAutoAdvancedDateKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    let stopped = false;

    async function refresh() {
      if (document.visibilityState === "hidden") return;
      const refreshedAt = new Date();
      setNow(refreshedAt);
      setSelectedDateKey((current) => {
        const result = getWallboardDateAfterRefresh({
          lastAutoAdvancedDateKey: lastAutoAdvancedDateKey.current,
          now: refreshedAt,
          selectedDateKey: current,
        });
        if (result.autoAdvancedFromDateKey) {
          lastAutoAdvancedDateKey.current = result.autoAdvancedFromDateKey;
        }
        return result.selectedDateKey;
      });
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
                className={`min-w-0 rounded-md border-2 border-l-[6px] px-3 py-2 shadow-lg ${STATUS_STYLE[presence.status]}`}
                data-presence-status={presence.status}
                data-testid={`presence-${technician.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ring-1 ring-inset ${STATUS_ICON_STYLE[presence.status]}`}
                    >
                      <PresenceIcon status={presence.status} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-base font-bold text-white">
                        {technician.displayName}
                      </div>
                      <div className="text-[11px] font-semibold text-white/75">
                        {technician.baseOfficeName ?? technician.storeLocation}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-black text-white drop-shadow-sm">
                      {presence.label}
                    </div>
                    {remainingLabel(presence, now) ? (
                      <div className="font-mono text-[11px] font-semibold text-white/85">
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
  const className = "h-5 w-5 shrink-0 stroke-[2.5]";
  if (status === "closed") return <Moon className={className} />;
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
  const endTime = new Date(presence.endsAt).getTime();
  if (!Number.isFinite(endTime)) return "";
  const minutes = Math.max(
    0,
    Math.ceil((endTime - now.getTime()) / 60_000),
  );
  if (minutes <= 0) return "";
  if (minutes <= 90) return `${minutes}m remaining`;

  if (minutes >= 1_440) {
    const roundedHours = Math.ceil(minutes / 60);
    const days = Math.floor(roundedHours / 24);
    const hours = roundedHours % 24;
    return `${days}d${hours > 0 ? ` ${hours}h` : ""} remaining`;
  }

  const remainingMinutes = minutes % 60;
  return `${Math.floor(minutes / 60)}h${
    remainingMinutes > 0 ? ` ${remainingMinutes}m` : ""
  } remaining`;
}

function formatClock(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Australia/Melbourne",
  }).format(new Date(value));
}

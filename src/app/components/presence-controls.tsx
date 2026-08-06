"use client";

import {
  Coffee,
  LoaderCircle,
  Palmtree,
  RotateCcw,
  UsersRound,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { Technician } from "@/server/dispatch/types";
import type {
  PresenceOverride,
  TechnicianPresence,
  WallboardSnapshot,
} from "@/server/presence/types";

const PRESENCE_FETCH_TIMEOUT_MS = 8_000;

export function PresenceControls({
  technicians,
}: {
  technicians: Technician[];
}) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<WallboardSnapshot | null>(null);
  const [busyTechnicianId, setBusyTechnicianId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<
    "clear" | "set_leave" | "start_lunch" | null
  >(null);
  const [leaveTechnicianId, setLeaveTechnicianId] = useState<string | null>(null);
  const [leaveReason, setLeaveReason] = useState("Annual leave");
  const [leaveEndsAt, setLeaveEndsAt] = useState("");
  const [error, setError] = useState("");

  const activeTechnicians = useMemo(
    () => technicians.filter((technician) => technician.active),
    [technicians],
  );

  async function loadSnapshot() {
    setError("");
    try {
      const response = await fetchWithTimeout(
        "/api/internal/presence",
        {
          cache: "no-store",
        },
        PRESENCE_FETCH_TIMEOUT_MS,
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      setSnapshot((await response.json()) as WallboardSnapshot);
    } catch (loadError) {
      setError(errorMessage(loadError, "Team status could not be loaded."));
    }
  }

  async function updatePresence(
    technicianId: string,
    body:
      | { action: "clear"; technicianId: string }
      | { action: "start_lunch"; technicianId: string }
      | {
          action: "set_leave";
          endsAt: string;
          reason: string;
          technicianId: string;
        },
  ) {
    setBusyTechnicianId(technicianId);
    setBusyAction(body.action);
    setError("");
    try {
      const response = await fetchWithTimeout(
        "/api/internal/presence",
        {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
        PRESENCE_FETCH_TIMEOUT_MS,
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      const result = (await response.json()) as {
        ok?: boolean;
        override?: PresenceOverride;
      };
      setSnapshot((current) =>
        updatePresenceSnapshot(current, technicians, technicianId, body.action, result.override),
      );
      setLeaveTechnicianId(null);
      void loadSnapshot();
    } catch (updateError) {
      setError(
        errorMessage(updateError, "The team status could not be updated."),
      );
    } finally {
      setBusyTechnicianId(null);
      setBusyAction(null);
    }
  }

  return (
    <>
      <button
        aria-expanded={open}
        aria-label="Team status"
        className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm font-semibold text-slate-200 hover:border-cc-orange/40 hover:bg-cc-orange/10"
        type="button"
        onClick={() => {
          setOpen(true);
          void loadSnapshot();
        }}
      >
        <UsersRound className="h-4 w-4 text-cc-orange" />
        Team status
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-end bg-black/40 p-3 pt-16"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpen(false);
          }}
        >
          <section
            aria-label="Team status"
            className="w-full max-w-lg rounded-md border border-cc-border bg-cc-surface-1 shadow-2xl"
            role="dialog"
          >
            <header className="flex items-center justify-between border-b border-cc-border px-3 py-2">
              <div>
                <div className="flex items-center gap-2">
                  <UsersRound className="h-4 w-4 text-cc-orange" />
                  <h2 className="text-sm font-semibold text-white">
                    Team status
                  </h2>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">
                  Lunch runs for 30 minutes. Leave remains until cleared or its
                  end time.
                </p>
              </div>
              <button
                aria-label="Close team status"
                className="rounded p-1.5 text-slate-400 hover:bg-white/5 hover:text-white"
                type="button"
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="max-h-[calc(100dvh-8rem)] overflow-y-auto p-2">
              {error ? (
                <div className="mb-2 rounded border border-rose-300/25 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
                  {error}
                </div>
              ) : null}

              {!snapshot ? (
                <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-slate-400">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Loading team status
                </div>
              ) : (
                <div className="divide-y divide-white/10">
                  {activeTechnicians.map((technician) => {
                    const presence = snapshot.presences.find(
                      (candidate) =>
                        candidate.technicianId === technician.id,
                    );
                    const isManual =
                      presence?.source === "manual_override";
                    const isBusy = busyTechnicianId === technician.id;
                    const leaveOpen = leaveTechnicianId === technician.id;

                    return (
                      <div key={technician.id} className="px-2 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white">
                              {technician.displayName}
                            </div>
                            <div className="truncate text-xs text-slate-400">
                              {presence?.label ?? "In office"}
                              {presence?.context
                                ? ` · ${presence.context}`
                                : ""}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {isManual ? (
                              <button
                                aria-busy={isBusy && busyAction === "clear"}
                                aria-label={
                                  isBusy && busyAction === "clear"
                                    ? "Clearing status..."
                                    : `Clear status for ${technician.displayName}`
                                }
                                className="flex items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50"
                                disabled={isBusy}
                                type="button"
                                onClick={() =>
                                  void updatePresence(technician.id, {
                                    action: "clear",
                                    technicianId: technician.id,
                                  })
                                }
                              >
                                {isBusy && busyAction === "clear" ? null : (
                                  <RotateCcw className="h-3.5 w-3.5" />
                                )}
                                {isBusy && busyAction === "clear" ? "Clearing..." : "Clear"}
                              </button>
                            ) : (
                              <>
                                <button
                                  aria-busy={isBusy && busyAction === "start_lunch"}
                                  aria-label={
                                    isBusy && busyAction === "start_lunch"
                                      ? "Starting Lunch..."
                                      : `Start Lunch for ${technician.displayName}`
                                  }
                                  className="flex items-center gap-1.5 rounded border border-amber-300/25 bg-amber-400/10 px-2 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-400/20 disabled:opacity-50"
                                  disabled={isBusy}
                                  type="button"
                                  onClick={() =>
                                    void updatePresence(technician.id, {
                                      action: "start_lunch",
                                      technicianId: technician.id,
                                    })
                                  }
                                >
                                  {isBusy && busyAction === "start_lunch" ? null : (
                                    <Coffee className="h-3.5 w-3.5" />
                                  )}
                                  {isBusy && busyAction === "start_lunch" ? "Starting Lunch..." : "Lunch"}
                                </button>
                                <button
                                  aria-label={`Set Leave for ${technician.displayName}`}
                                  className="flex items-center gap-1.5 rounded border border-violet-300/25 bg-violet-400/10 px-2 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-400/20 disabled:opacity-50"
                                  disabled={isBusy}
                                  type="button"
                                  onClick={() => {
                                    setLeaveTechnicianId(technician.id);
                                    setLeaveReason("Annual leave");
                                  }}
                                >
                                  <Palmtree className="h-3.5 w-3.5" />
                                  Leave
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {leaveOpen ? (
                          <div className="mt-2 grid grid-cols-[1fr_1.25fr_auto] items-end gap-2 rounded border border-violet-300/15 bg-violet-400/5 p-2">
                            <label className="text-[11px] font-semibold text-slate-300">
                              Leave type
                              <select
                                className="mt-1 w-full rounded border border-white/10 bg-cc-canvas px-2 py-1.5 text-xs text-white"
                                value={leaveReason}
                                onChange={(event) =>
                                  setLeaveReason(event.target.value)
                                }
                              >
                                <option>Annual leave</option>
                                <option>Sick</option>
                                <option>Personal leave</option>
                                <option>Unavailable</option>
                              </select>
                            </label>
                            <label className="text-[11px] font-semibold text-slate-300">
                              Leave until
                              <input
                                className="mt-1 w-full rounded border border-white/10 bg-cc-canvas px-2 py-1.5 text-xs text-white [color-scheme:dark]"
                                type="datetime-local"
                                value={leaveEndsAt}
                                onChange={(event) =>
                                  setLeaveEndsAt(event.target.value)
                                }
                              />
                            </label>
                            <button
                              aria-busy={isBusy && busyAction === "set_leave"}
                              className="rounded bg-cc-orange px-2.5 py-1.5 text-xs font-bold text-cc-surface-1 disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={!leaveEndsAt || isBusy}
                              type="button"
                              onClick={() =>
                                void updatePresence(technician.id, {
                                  action: "set_leave",
                                  endsAt: leaveEndsAt,
                                  reason: leaveReason,
                                  technicianId: technician.id,
                                })
                              }
                            >
                              {isBusy && busyAction === "set_leave" ? "Saving Leave..." : "Confirm Leave"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

async function responseMessage(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function updatePresenceSnapshot(
  snapshot: WallboardSnapshot | null,
  technicians: Technician[],
  technicianId: string,
  action: "clear" | "set_leave" | "start_lunch",
  override?: PresenceOverride,
): WallboardSnapshot | null {
  if (!snapshot) return snapshot;

  const technician = technicians.find((candidate) => candidate.id === technicianId);
  if (!technician) return snapshot;

  const nextPresence =
    action === "clear" || !override
      ? fallbackOfficePresence(technician)
      : presenceFromOverride(technicianId, override);

  return {
    ...snapshot,
    presences: snapshot.presences.map((presence) =>
      presence.technicianId === technicianId ? nextPresence : presence,
    ),
    updatedAt: new Date().toISOString(),
  };
}

function presenceFromOverride(
  technicianId: string,
  override: PresenceOverride,
): TechnicianPresence {
  return {
    conflicts: [],
    context:
      override.status === "lunch"
        ? "Lunch break"
        : override.reason ?? "Unavailable",
    endsAt: override.endsAt,
    label: override.status === "lunch" ? "Lunch" : "Leave",
    source: "manual_override",
    startsAt: override.startsAt,
    status: override.status,
    technicianId,
  };
}

function fallbackOfficePresence(technician: Technician): TechnicianPresence {
  return {
    conflicts: [],
    context:
      technician.baseOfficeName ??
      technician.storeLocation ??
      technician.baseOfficeId ??
      "Office",
    label: "In office",
    source: "schedule",
    status: "in_office",
    technicianId: technician.id,
  };
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Team status request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

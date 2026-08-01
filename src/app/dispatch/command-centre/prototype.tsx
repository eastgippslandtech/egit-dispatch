"use client";

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Filter,
  Frown,
  GitMerge,
  LogOut,
  MailWarning,
  Meh,
  Monitor,
  PhoneCall,
  RefreshCw,
  Search,
  Smile,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CommandCentreLogo } from "@/app/components/command-centre-logo";
import { PresenceControls } from "@/app/components/presence-controls";
import type {
  MspCentralRequestContext,
  MspCentralRequestUpdate,
} from "@/server/msp-central/types";

import type {
  Appointment,
  BookingType,
  DispatchDashboardData,
  DispatchRequest,
  HealthItem,
  Severity,
  Technician,
} from "@/server/dispatch/types";
import { getChargeableTicketTime } from "@/server/dispatch/chargeable-time";
import {
  applyBookingTypeToRequest,
  bookingTiming,
  bookingTypeForRequest,
} from "@/server/dispatch/booking";
import { buildDispatchHealthItems } from "@/server/dispatch/health";
import {
  buildStackedTimelineLayout,
  buildTimelineLayout,
  getTimelineAppointmentSegments,
  type TimelineLayoutItem,
} from "@/server/dispatch/timeline-layout";
import {
  addDaysToDateKey,
  appointmentsForDate,
  appointmentsForRange,
  buildScopedDispatchData,
  DISPATCH_TIMEZONE,
  formatSelectedDateLabel,
  getWeekRange,
  groupWeekAppointments,
  mockIsoTime,
  selectedDateIsPast,
  todayDateKey,
  type ViewMode,
} from "@/server/dispatch/date-scope";
import {
  buildScheduleSlot,
  buildTimelineMarkers,
  detectScheduleWarnings,
  getTimelineItemPosition,
  minutesFromTime,
  moveAppointment,
  scheduleRequest,
  shouldShowTimelineHourLabel,
  TIMELINE_TRACK_WIDTH_PX,
  timeFromMinutes,
  timelinePositionToTime,
  type ScheduleWarning,
} from "@/server/dispatch/scheduling";
import {
  getCurrentTimeIndicator,
  getWeekTodayDateKey,
  type CurrentTimeIndicator,
} from "@/server/dispatch/current-time";
import { formatTalkTime } from "@/server/yeastar/talk-time";
import {
  applyTravelToAppointment,
  buildAppointmentTravel,
  getAppointmentBlockedWindow,
  type TravelEstimate,
} from "@/server/dispatch/travel";

type Selection =
  | { kind: "request"; requestId: string }
  | { kind: "appointment"; appointmentId: string; requestId?: string };

type DragPayload =
  | { kind: "request"; requestId: string }
  | { kind: "appointment"; appointmentId: string };

type LiveScheduleResult = {
  id?: string;
  webLink?: string;
};

const PRIMARY_HEALTH_KEYS = [
  "unscheduled",
  "sla-risk",
  "double-booked",
  "time-mismatch",
  "travel-conflicts",
  "out-of-hours",
];

const SECONDARY_HEALTH_KEYS = [
  "missing-calendar",
  "past-open",
  "mapping",
  "unlinked-outlook",
  "closed-day",
  "all-day-events",
];

const HEALTH_SHORT_LABELS: Record<string, string> = {
  "all-day-events": "All-Day Blocks",
  "closed-day": "Closed Day",
  "double-booked": "Double Bookings",
  mapping: "Missing Tech Map",
  "missing-calendar": "Missing Calendar",
  "out-of-hours": "Out-of-Hours",
  "past-open": "Past Open",
  "sla-risk": "SLA Risk",
  "time-mismatch": "Sync Issues",
  "travel-conflicts": "Travel",
  "unlinked-outlook": "Unlinked Outlook",
  unscheduled: "Unscheduled",
};

const BOOKING_PRIORITY_CARD_CLASSES: Record<DispatchRequest["priority"], string> = {
  Critical: "border-rose-300/75 bg-rose-500/48 text-rose-50 shadow-rose-950/35",
  High: "border-amber-300/75 bg-amber-400/42 text-amber-50 shadow-amber-950/30",
  Medium:
    "border-emerald-300/65 bg-emerald-500/30 text-emerald-50 shadow-emerald-950/25",
  Low: "border-sky-300/65 bg-sky-500/28 text-sky-50 shadow-sky-950/25",
};

export function bookingCardPriorityClass(
  priority?: DispatchRequest["priority"] | null,
) {
  return priority
    ? BOOKING_PRIORITY_CARD_CLASSES[priority]
    : "border-slate-400/30 bg-slate-500/18 text-slate-100 shadow-slate-950/20";
}

type QueueFilterKey = "priority" | "sla" | "status" | "technician";
type QueueFilters = Partial<Record<QueueFilterKey, string>>;
type SearchState = "dimmed" | "match" | "normal";
type SeenTicketUpdateIds = Set<string>;

const TECHNICIAN_COLUMN_WIDTH_PX = 170;
const TIMELINE_HEADER_HEIGHT_PX = 40;

type DropPreview = {
  date: string;
  end: string;
  start: string;
  technicianId: string;
  travelBackToOfficeMinutes?: number;
  travelToSiteMinutes?: number;
  warning: boolean;
};

type PendingSchedule =
  | {
      bookingType: BookingType;
      durationMinutes: number;
      kind: "request";
      date: string;
      requestId: string;
      start: string;
      end: string;
      technicianId: string;
      travel?: TravelEstimate;
      warnings: ScheduleWarning[];
    }
  | {
      appointmentId: string;
      bookingType: BookingType;
      durationMinutes: number;
      kind: "appointment";
      date: string;
      oldEnd: string;
      oldDate: string;
      oldStart: string;
      oldTechnicianId: string;
      start: string;
      end: string;
      technicianId: string;
      travel?: TravelEstimate;
      warnings: ScheduleWarning[];
    };

type DispatchTestSyncEventPayload = {
  appointmentId?: string;
  bookingType?: BookingType;
  date?: string;
  end?: string;
  eventType: "scheduled" | "rescheduled" | "cancelled" | "notes_updated" | "work_logged";
  notes?: string;
  payload?: {
    travel?: TravelEstimate;
    workLog?: {
      billable: boolean;
      minutesSpent: number;
      notes: string;
      status?: DispatchRequest["status"];
      visibility: "Customer-facing" | "Internal";
      workType: BookingType;
    };
  };
  priority?: DispatchRequest["priority"];
  requestId?: string;
  start?: string;
  technicianId?: string;
};

export function CommandCentrePrototype({
  authDisabled = false,
  data,
}: {
  authDisabled?: boolean;
  data: DispatchDashboardData;
}) {
  const router = useRouter();
  const [dashboard, setDashboard] = useState(data);
  const [selectedDateKey, setSelectedDateKey] = useState(todayDateKey());
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [now, setNow] = useState(() => new Date());
  const [selection, setSelection] = useState<Selection>({
    kind: "request",
    requestId: data.selectedRequestId,
  });
  const [activeHealth, setActiveHealth] = useState<string | undefined>();
  const [showMoreHealth, setShowMoreHealth] = useState(false);
  const [topSearch, setTopSearch] = useState("");
  const [queueSearch, setQueueSearch] = useState("");
  const [queueFilters, setQueueFilters] = useState<QueueFilters>({});
  const [openQueueFilter, setOpenQueueFilter] = useState<QueueFilterKey>();
  const [seenTicketUpdateIds, setSeenTicketUpdateIds] =
    useState<SeenTicketUpdateIds>(() => new Set());
  const [dragPayload, setDragPayload] = useState<DragPayload | undefined>();
  const [dropPreview, setDropPreview] = useState<DropPreview | undefined>();
  const [pendingSchedule, setPendingSchedule] = useState<
    PendingSchedule | undefined
  >();
  const [mergeRequestId, setMergeRequestId] = useState<string | undefined>();
  const [workLogRequestId, setWorkLogRequestId] = useState<string | undefined>();
  const [toast, setToast] = useState<string | undefined>();

  useEffect(() => {
    if (!data.calendarError?.includes("MSP Central is temporarily unavailable")) {
      return;
    }

    const retry = window.setInterval(() => router.refresh(), 30_000);
    return () => window.clearInterval(retry);
  }, [data.calendarError, router]);

  const selectedDateLabel = formatSelectedDateLabel(selectedDateKey);
  const weekDays = useMemo(() => getWeekRange(selectedDateKey), [selectedDateKey]);
  const currentTimeIndicator = useMemo(
    () => getCurrentTimeIndicator(selectedDateKey, now),
    [now, selectedDateKey],
  );
  const weekTodayDateKey = useMemo(
    () => getWeekTodayDateKey(weekDays, now),
    [now, weekDays],
  );
  const scopedData = useMemo(
    () =>
      buildScopedDispatchData(dashboard, {
        dateKey: selectedDateKey,
        mode: viewMode,
      }),
    [dashboard, selectedDateKey, viewMode],
  );
  const dayAppointments = useMemo(
    () => appointmentsForDate(dashboard.appointments, selectedDateKey),
    [dashboard.appointments, selectedDateKey],
  );
  const weekAppointments = useMemo(
    () =>
      appointmentsForRange(
        dashboard.appointments,
        weekDays.map((day) => day.dateKey),
      ),
    [dashboard.appointments, weekDays],
  );

  const healthItems = useMemo(
    () =>
      buildDispatchHealthItems({
        appointments: scopedData.appointments,
        requests: scopedData.requests,
        technicians: scopedData.technicians,
      }),
    [scopedData],
  );
  const primaryHealthItems = useMemo(
    () =>
      healthItems.filter((item) => PRIMARY_HEALTH_KEYS.includes(item.key)),
    [healthItems],
  );
  const secondaryHealthItems = useMemo(
    () =>
      healthItems.filter((item) => SECONDARY_HEALTH_KEYS.includes(item.key)),
    [healthItems],
  );
  const activeHealthItem = healthItems.find((item) => item.key === activeHealth);
  const secondaryIssueCount = secondaryHealthItems.reduce(
    (total, item) => total + item.count,
    0,
  );
  const secondaryHealthActive = secondaryHealthItems.some(
    (item) => item.key === activeHealth,
  );

  const selectedAppointment = useMemo(
    () =>
      selection.kind === "appointment"
        ? dashboard.appointments.find(
            (appointment) => appointment.id === selection.appointmentId,
          )
        : undefined,
    [dashboard.appointments, selection],
  );

  const selectedRequest = useMemo(() => {
    const requestId =
      selection.kind === "request"
        ? selection.requestId
        : selectedAppointment?.requestId ?? selection.requestId;

    return dashboard.requests.find((request) => request.id === requestId);
  }, [dashboard.requests, selectedAppointment, selection]);

  const fallbackRequest = selectedRequest ?? dashboard.requests[0];

  const unscheduledRequests = dashboard.requests.filter(
    (request) => !request.scheduledStart && request.status !== "Resolved",
  );
  const queueRequests = activeHealth
    ? dashboard.requests.filter((request) =>
        requestMatchesHealthFilter(
          request,
          activeHealth,
          scopedData.appointments,
        ),
      )
    : unscheduledRequests;
  const filteredQueueRequests = queueRequests.filter(
    (request) =>
      requestMatchesSearch(request, queueSearch, dashboard.technicians) &&
      requestMatchesSearch(request, topSearch, dashboard.technicians) &&
      requestMatchesQueueFilters(request, queueFilters),
  );
  const queueEmptyText = activeHealth
    ? "No requests match this health filter"
    : "No matching requests";
  const filtersActive = Boolean(
    topSearch.trim() ||
      queueSearch.trim() ||
      activeHealth ||
      Object.values(queueFilters).some(Boolean),
  );
  const activeFilterSummary = buildActiveFilterSummary({
    activeHealthItem,
    queueFilters,
    queueSearch,
    topSearch,
  });

  function clearAllFilters() {
    setTopSearch("");
    setQueueSearch("");
    setQueueFilters({});
    setOpenQueueFilter(undefined);
    setActiveHealth(undefined);
  }

  function markTicketUpdateSeen(requestId?: string) {
    if (!requestId) {
      return;
    }

    setSeenTicketUpdateIds((current) => {
      if (current.has(requestId)) {
        return current;
      }

      const next = new Set(current);
      next.add(requestId);
      return next;
    });
  }

  function selectRequest(requestId: string) {
    setSelection({ kind: "request", requestId });
    markTicketUpdateSeen(requestId);
  }

  function selectAppointment(appointment: Appointment) {
    setSelection({
      kind: "appointment",
      appointmentId: appointment.id,
      requestId: appointment.requestId,
    });
    markTicketUpdateSeen(appointment.requestId);
  }

  async function mergeRequestIntoParent(parentRequestId: string) {
    const childRequest = dashboard.requests.find(
      (request) => request.id === mergeRequestId,
    );
    const parentRequest = dashboard.requests.find(
      (request) => request.id === parentRequestId,
    );

    if (!childRequest || !parentRequest) {
      throw new Error("The duplicate or surviving request is no longer available.");
    }

    await publishMspCentralRequestMerge({
      childRequestId: childRequest.id,
      parentRequestId: parentRequest.id,
    });

    setDashboard((current) => ({
      ...current,
      appointments: current.appointments.map((appointment) =>
        appointment.requestId === childRequest.id
          ? { ...appointment, requestId: parentRequest.id }
          : appointment,
      ),
      requests: current.requests.filter(
        (request) => request.id !== childRequest.id,
      ),
      selectedRequestId:
        current.selectedRequestId === childRequest.id
          ? parentRequest.id
          : current.selectedRequestId,
    }));
    setSelection({ kind: "request", requestId: parentRequest.id });
    setMergeRequestId(undefined);
    setToast(
      `${childRequest.requestNumber} merged into ${parentRequest.requestNumber}.`,
    );
  }

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);

    return () => window.clearInterval(interval);
  }, []);

  const pendingRequest = useMemo(() => {
    if (!pendingSchedule) {
      return undefined;
    }

    if (pendingSchedule.kind === "request") {
      return dashboard.requests.find(
        (request) => request.id === pendingSchedule.requestId,
      );
    }

    const appointment = dashboard.appointments.find(
      (candidate) => candidate.id === pendingSchedule.appointmentId,
    );

    return dashboard.requests.find(
      (request) => request.id === appointment?.requestId,
    );
  }, [dashboard.appointments, dashboard.requests, pendingSchedule]);

  function beginDrag(payload: DragPayload) {
    if (payload.kind === "appointment") {
      const appointment = dashboard.appointments.find(
        (candidate) => candidate.id === payload.appointmentId,
      );

      if (appointment?.readOnly) {
        setToast("Outlook calendar is read-only.");
        return;
      }
    }

    setDragPayload(payload);
  }

  function endDrag() {
    setDragPayload(undefined);
    setDropPreview(undefined);
  }

  function clearSelectionForDateChange(nextDateKey: string, nextMode = viewMode) {
    setSelectedDateKey(nextDateKey);
    setViewMode(nextMode);
    setSelection({ kind: "request", requestId: data.selectedRequestId });
    setPendingSchedule(undefined);
    setDropPreview(undefined);
  }

  async function saveWorkLog({
    billable,
    complete,
    minutes,
    notes,
    visibility,
    workType,
  }: {
    billable: boolean;
    complete: boolean;
    minutes: string;
    notes: string;
    visibility: "external" | "internal";
    workType: string;
  }) {
    const requestId = workLogRequestId;
    if (!requestId) return;
    const selectedWorklogRequest = dashboard.requests.find(
      (candidate) => candidate.id === requestId,
    );
    const worklogAppointment = dashboard.appointments.find(
      (candidate) => candidate.requestId === requestId,
    );
    if (!selectedWorklogRequest) return;

    const trimmedNotes = notes.trim();
    if (!trimmedNotes) {
      setToast("Work Log notes are required.");
      return;
    }
    const durationMinutes = Math.round(Number(minutes));
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      setToast("Work Log time must be greater than zero.");
      return;
    }

    const updateAt = new Date().toISOString();
    const liveWorklog =
      dashboard.dispatchDataSource === "msp-central" &&
      selectedWorklogRequest.sourceSystem === "msp-central";

    if (liveWorklog) {
      const endedAt = worklogAppointment?.date
        ? mockIsoTime(worklogAppointment.date, worklogAppointment.end)
        : updateAt;
      const startedAt = worklogAppointment?.date
        ? mockIsoTime(worklogAppointment.date, worklogAppointment.start)
        : new Date(
            new Date(endedAt).getTime() - durationMinutes * 60_000,
          ).toISOString();

      try {
        await publishMspCentralWorklog({
          complete,
          description: trimmedNotes,
          durationMinutes,
          endedAt,
          requestId,
          startedAt,
        });
      } catch (error) {
        setToast(
          error instanceof Error
            ? `Work Log did not save: ${error.message}`
            : "Work Log did not save.",
        );
        return;
      }
    }

    setDashboard((current) => {
      const requests = current.requests.map((request) => {
        if (request.id !== requestId) {
          return request;
        }

        const metadata = [
          `${durationMinutes} min`,
          workTypeLabel(workType),
          visibility === "external" ? "customer-facing" : "internal",
          billable ? "billable" : "non-billable",
          liveWorklog ? "MSP Central" : "mock/test-sync",
        ].join(" · ");

        return {
          ...request,
          notes: request.notes
            ? `${request.notes}\n\n${trimmedNotes} (${metadata})`
            : `${trimmedNotes} (${metadata})`,
          readyToBook: complete ? false : request.readyToBook,
          status: complete ? ("Resolved" as const) : request.status,
          updateInfo: {
            at: updateAt,
            detail: trimmedNotes,
            source: "command-centre" as const,
            summary: complete ? "Work Log completed" : "Work Log added",
          },
          warnings: complete
            ? request.warnings.filter((warning) => warning !== "Ready to book")
            : request.warnings,
        };
      });

      return {
        ...current,
        requests,
      };
    });

    markTicketUpdateSeen(requestId);
    setWorkLogRequestId(undefined);
    setToast(
      liveWorklog
        ? complete
          ? "Work Log saved and ticket resolved in MSP Central."
          : "Work Log saved in MSP Central."
        : complete
          ? "Work Log saved and ticket resolved locally for test sync."
          : "Work Log saved locally for test sync.",
    );
  }

  function buildWarnings({
    appointmentId,
    date,
    end,
    start,
    technicianId,
    travelAppointment,
  }: {
    appointmentId?: string;
    date: string;
    end: string;
    start: string;
    technicianId: string;
    travelAppointment?: Appointment;
  }) {
    return detectScheduleWarnings({
      appointmentId,
      appointments: dashboard.appointments,
      date,
      end,
      selectedDateIsPast: selectedDateIsPast(date),
      start,
      technician: dashboard.technicians.find(
        (technician) => technician.id === technicianId,
      ),
      technicianId,
      travelAppointment,
    });
  }

  function buildTravel(
    request: DispatchRequest | undefined,
    technicianId: string,
    bookingType?: BookingType,
  ) {
    return buildAppointmentTravel({
      request: request
        ? applyBookingTypeToRequest(
            request,
            bookingType ?? bookingTypeForRequest(request),
          )
        : undefined,
      technician: dashboard.technicians.find(
        (technician) => technician.id === technicianId,
      ),
    });
  }

  function buildTravelCandidate({
    appointmentId,
    bookingType,
    date,
    end,
    request,
    start,
    technicianId,
    travel,
  }: {
    appointmentId?: string;
    bookingType?: BookingType;
    date: string;
    end: string;
    request?: DispatchRequest;
    start: string;
    technicianId: string;
    travel?: TravelEstimate;
  }) {
    return applyTravelToAppointment(
      {
        id: appointmentId ?? "pending",
        bookingType,
        customer: request?.customer ?? "Pending",
        date,
        end,
        requestId: request?.id,
        siteAddress: request?.siteAddress,
        siteArea: request?.siteArea,
        siteTown: request?.siteTown,
        source: "linked",
        start,
        status: "tentative",
        technicianId,
        title: request?.subject ?? "Pending appointment",
      },
      travel,
    );
  }

  function createPendingSchedule(
    payload: DragPayload,
    technicianId: string,
    start: string,
    date = selectedDateKey,
  ) {
    if (payload.kind === "request") {
      const request = dashboard.requests.find(
        (candidate) => candidate.id === payload.requestId,
      );

      if (!request) {
        return undefined;
      }

      const bookingType = bookingTypeForRequest(request);
      const durationMinutes = 60;
      const slot = buildScheduleSlot(
        start,
        bookingTiming(durationMinutes, bookingType).totalDurationMinutes,
      );
      const travel = buildTravel(request, technicianId, bookingType);
      const travelAppointment = buildTravelCandidate({
        date,
        end: slot.end,
        request,
        start: slot.start,
        technicianId,
        travel,
      });

      return {
        bookingType,
        durationMinutes,
        kind: "request",
        date,
        requestId: request.id,
        start: slot.start,
        end: slot.end,
        technicianId,
        travel,
        warnings: buildWarnings({
          date,
          end: slot.end,
          start: slot.start,
          technicianId,
          travelAppointment,
        }),
      } satisfies PendingSchedule;
    }

    const appointment = dashboard.appointments.find(
      (candidate) => candidate.id === payload.appointmentId,
    );

    if (!appointment) {
      return undefined;
    }

    const request = dashboard.requests.find(
      (candidate) => candidate.id === appointment.requestId,
    );
    const bookingType =
      appointment.bookingType ??
      (request ? bookingTypeForRequest(request) : "Remote");
    const totalDurationMinutes =
      minutesFromTime(appointment.end) - minutesFromTime(appointment.start);
    const durationMinutes =
      appointment.workDurationMinutes ??
      Math.max(
        15,
        totalDurationMinutes - (bookingType === "Onsite" ? 15 : 0),
      );
    const slot = buildScheduleSlot(
      start,
      bookingTiming(durationMinutes, bookingType).totalDurationMinutes,
    );
    const travel = request
      ? buildTravel(request, technicianId, bookingType)
      : undefined;
    const travelAppointment = buildTravelCandidate({
      appointmentId: appointment.id,
      bookingType,
      date,
      end: slot.end,
      request,
      start: slot.start,
      technicianId,
      travel,
    });

    return {
      appointmentId: appointment.id,
      bookingType,
      durationMinutes,
      kind: "appointment",
      date,
      oldEnd: appointment.end,
      oldDate: appointment.date ?? selectedDateKey,
      oldStart: appointment.start,
      oldTechnicianId: appointment.technicianId,
      start: slot.start,
      end: slot.end,
      technicianId,
      travel,
      warnings: buildWarnings({
        appointmentId: appointment.id,
        date,
        end: slot.end,
        start: slot.start,
        technicianId,
        travelAppointment,
      }),
    } satisfies PendingSchedule;
  }

  function handleTimelineHover(
    payload: DragPayload,
    technicianId: string,
    start: string,
  ) {
    const pending = createPendingSchedule(
      payload,
      technicianId,
      start,
      selectedDateKey,
    );

    if (!pending) {
      return;
    }

    setDropPreview({
      date: pending.date,
      end: pending.end,
      start: pending.start,
      technicianId: pending.technicianId,
      travelBackToOfficeMinutes: pending.travel?.travelBackToOfficeMinutes,
      travelToSiteMinutes: pending.travel?.travelToSiteMinutes,
      warning: pending.warnings.length > 0,
    });
  }

  function handleTimelineDrop(
    payload: DragPayload,
    technicianId: string,
    start: string,
  ) {
    const pending = createPendingSchedule(
      payload,
      technicianId,
      start,
      selectedDateKey,
    );

    if (pending) {
      setPendingSchedule(pending);
    }

    endDrag();
  }

  function updatePendingDuration(durationMinutes: number) {
    setPendingSchedule((current) => {
      if (!current) {
        return current;
      }

      const slot = buildScheduleSlot(
        current.start,
        bookingTiming(durationMinutes, current.bookingType).totalDurationMinutes,
      );
      const request =
        current.kind === "request"
          ? dashboard.requests.find((candidate) => candidate.id === current.requestId)
          : dashboard.requests.find(
              (candidate) =>
                candidate.id ===
                dashboard.appointments.find(
                  (appointment) => appointment.id === current.appointmentId,
                )?.requestId,
            );
      const travelAppointment = buildTravelCandidate({
        appointmentId:
          current.kind === "appointment" ? current.appointmentId : undefined,
        bookingType: current.bookingType,
        date: current.date,
        end: slot.end,
        request,
        start: slot.start,
        technicianId: current.technicianId,
        travel: current.travel,
      });
      const warnings = buildWarnings({
        appointmentId:
          current.kind === "appointment" ? current.appointmentId : undefined,
        date: current.date,
        end: slot.end,
        start: slot.start,
        technicianId: current.technicianId,
        travelAppointment,
      });

      return {
        ...current,
        durationMinutes,
        end: slot.end,
        warnings,
      };
    });
  }

  function updatePendingStart(start: string) {
    setPendingSchedule((current) => {
      if (!current) {
        return current;
      }

      const slot = buildScheduleSlot(
        start,
        bookingTiming(current.durationMinutes, current.bookingType)
          .totalDurationMinutes,
      );
      const request =
        current.kind === "request"
          ? dashboard.requests.find((candidate) => candidate.id === current.requestId)
          : dashboard.requests.find(
              (candidate) =>
                candidate.id ===
                dashboard.appointments.find(
                  (appointment) => appointment.id === current.appointmentId,
                )?.requestId,
            );
      const travelAppointment = buildTravelCandidate({
        appointmentId:
          current.kind === "appointment" ? current.appointmentId : undefined,
        bookingType: current.bookingType,
        date: current.date,
        end: slot.end,
        request,
        start: slot.start,
        technicianId: current.technicianId,
        travel: current.travel,
      });
      const warnings = buildWarnings({
        appointmentId:
          current.kind === "appointment" ? current.appointmentId : undefined,
        date: current.date,
        end: slot.end,
        start: slot.start,
        technicianId: current.technicianId,
        travelAppointment,
      });

      return {
        ...current,
        start: slot.start,
        end: slot.end,
        warnings,
      };
    });
  }

  function updatePendingTechnician(technicianId: string) {
    setPendingSchedule((current) => {
      if (!current) {
        return current;
      }

      const request =
        current.kind === "request"
          ? dashboard.requests.find((candidate) => candidate.id === current.requestId)
          : dashboard.requests.find(
              (candidate) =>
                candidate.id ===
                dashboard.appointments.find(
                  (appointment) => appointment.id === current.appointmentId,
                )?.requestId,
            );
      const travel = buildTravel(request, technicianId, current.bookingType);
      const travelAppointment = buildTravelCandidate({
        appointmentId:
          current.kind === "appointment" ? current.appointmentId : undefined,
        bookingType: current.bookingType,
        date: current.date,
        end: current.end,
        request,
        start: current.start,
        technicianId,
        travel,
      });
      const warnings = buildWarnings({
        appointmentId:
          current.kind === "appointment" ? current.appointmentId : undefined,
        date: current.date,
        end: current.end,
        start: current.start,
        technicianId,
        travelAppointment,
      });

      return {
        ...current,
        technicianId,
        travel,
        warnings,
      };
    });
  }

  function updatePendingBookingType(bookingType: BookingType) {
    setPendingSchedule((current) => {
      if (!current) {
        return current;
      }

      const request =
        current.kind === "request"
          ? dashboard.requests.find((candidate) => candidate.id === current.requestId)
          : dashboard.requests.find(
              (candidate) =>
                candidate.id ===
                dashboard.appointments.find(
                  (appointment) => appointment.id === current.appointmentId,
                )?.requestId,
            );
      const slot = buildScheduleSlot(
        current.start,
        bookingTiming(current.durationMinutes, bookingType).totalDurationMinutes,
      );
      const travel = buildTravel(request, current.technicianId, bookingType);
      const travelAppointment = buildTravelCandidate({
        appointmentId:
          current.kind === "appointment" ? current.appointmentId : undefined,
        bookingType,
        date: current.date,
        end: slot.end,
        request,
        start: current.start,
        technicianId: current.technicianId,
        travel,
      });

      return {
        ...current,
        bookingType,
        end: slot.end,
        travel,
        warnings: buildWarnings({
          appointmentId:
            current.kind === "appointment" ? current.appointmentId : undefined,
          date: current.date,
          end: slot.end,
          start: current.start,
          technicianId: current.technicianId,
          travelAppointment,
        }),
      };
    });
  }

  function handleWeekDrop(
    payload: DragPayload,
    technicianId: string,
    dateKey: string,
  ) {
    const appointment =
      payload.kind === "appointment"
        ? dashboard.appointments.find(
            (candidate) => candidate.id === payload.appointmentId,
          )
        : undefined;
    const pending = createPendingSchedule(
      payload,
      technicianId,
      appointment?.start ?? "09:00",
      dateKey,
    );

    if (pending) {
      setPendingSchedule(pending);
    }

    endDrag();
  }

  async function confirmPendingSchedule() {
    if (!pendingSchedule) {
      return;
    }

    if (pendingSchedule.kind === "request") {
      const request = dashboard.requests.find(
        (candidate) => candidate.id === pendingSchedule.requestId,
      );

      if (!request) {
        return;
      }

      const liveSchedule = canUseLiveSchedule(dashboard, request);
      let liveEvent: LiveScheduleResult | undefined;
      const appointmentId = liveSchedule
        ? `pending-live-${request.id}-${Date.now()}`
        : `mock-${request.id}-${Date.now()}`;
      const bookingType = pendingSchedule.bookingType;

      try {
        if (liveSchedule) {
          liveEvent = await publishLiveSchedule({
            bookingType,
            customer: request.customer,
            date: pendingSchedule.date,
            end: pendingSchedule.end,
            location: request.siteAddress ?? request.site,
            requestId: request.id,
            requestNumber: request.requestNumber,
            start: pendingSchedule.start,
            subject: request.subject,
            technicianName: technicianLabel(
              dashboard.technicians,
              pendingSchedule.technicianId,
            ),
            technicianEmail: technicianMspCentralIdentity(
              dashboard.technicians,
              pendingSchedule.technicianId,
            ),
            userPrincipalName: technicianOutlookIdentity(
              dashboard.technicians,
              pendingSchedule.technicianId,
            ),
          });
        } else {
          await publishDispatchTestSyncEvent({
            appointmentId,
            bookingType,
            date: pendingSchedule.date,
            end: pendingSchedule.end,
            eventType: "scheduled",
            priority: request.priority,
            requestId: request.id,
            start: pendingSchedule.start,
            technicianId: pendingSchedule.technicianId,
            payload: {
              travel: pendingSchedule.travel,
            },
          });
        }
      } catch (error) {
        setToast(
          liveSchedule ? liveScheduleErrorMessage(error) : testSyncErrorMessage(error),
        );
        return;
      }

      const finalAppointmentId = liveEvent?.id
        ? `outlook-${pendingSchedule.technicianId}-${liveEvent.id}`
        : appointmentId;
      const appointments = scheduleRequest({
        appointmentId: finalAppointmentId,
        appointments: dashboard.appointments,
        bookingType,
        date: pendingSchedule.date,
        durationMinutes: pendingSchedule.durationMinutes,
        request,
        start: pendingSchedule.start,
        technicianId: pendingSchedule.technicianId,
        travel: pendingSchedule.travel,
      });

      setDashboard((current) => ({
        ...current,
        appointments: appointments.map((appointment) =>
          appointment.id === finalAppointmentId
            ? {
                ...appointment,
                outlookEventId: liveEvent?.id ?? appointment.outlookEventId,
                outlookWebLink: liveEvent?.webLink ?? appointment.outlookWebLink,
                readOnly: false,
                status: liveSchedule ? "confirmed" : appointment.status,
              }
            : appointment,
        ),
        requests: current.requests.map((candidate) =>
          candidate.id === request.id
            ? {
                ...candidate,
                bookingType,
                onsite: bookingType === "Onsite",
                status: "Scheduled",
                technicianId: pendingSchedule.technicianId,
                scheduledStart: mockIsoTime(
                  pendingSchedule.date,
                  pendingSchedule.start,
                ),
                scheduledEnd: mockIsoTime(
                  pendingSchedule.date,
                  pendingSchedule.end,
                ),
                readyToBook: false,
                warnings: [
                  liveSchedule ? "Scheduled" : "Mock scheduled",
                  ...(pendingSchedule.travel?.travelWarning
                    ? [pendingSchedule.travel.travelWarning]
                    : []),
                ],
              }
            : candidate,
        ),
      }));
      setSelection({
        kind: "appointment",
        appointmentId: finalAppointmentId,
        requestId: request.id,
      });
      setToast(
        liveSchedule
          ? `${request.requestNumber} scheduled in MSP Central and Outlook.`
          : `${request.requestNumber} scheduled in mock mode.`,
      );
    } else {
      const currentAppointment = dashboard.appointments.find(
        (appointment) => appointment.id === pendingSchedule.appointmentId,
      );
      const request = currentAppointment?.requestId
        ? dashboard.requests.find(
            (candidate) => candidate.id === currentAppointment.requestId,
          )
        : undefined;
      const bookingType = pendingSchedule.bookingType;

      const liveSchedule =
        Boolean(request) && canUseLiveSchedule(dashboard, request);
      let liveEvent: LiveScheduleResult | undefined;

      try {
        if (liveSchedule && request) {
          liveEvent = await publishLiveSchedule({
            bookingType,
            customer: request.customer,
            date: pendingSchedule.date,
            end: pendingSchedule.end,
            eventId: currentAppointment?.outlookEventId,
            location: request.siteAddress ?? request.site,
            requestId: request.id,
            requestNumber: request.requestNumber,
            start: pendingSchedule.start,
            subject: request.subject,
            technicianName: technicianLabel(
              dashboard.technicians,
              pendingSchedule.technicianId,
            ),
            technicianEmail: technicianMspCentralIdentity(
              dashboard.technicians,
              pendingSchedule.technicianId,
            ),
            userPrincipalName: technicianOutlookIdentity(
              dashboard.technicians,
              pendingSchedule.technicianId,
            ),
          });
        } else {
          await publishDispatchTestSyncEvent({
            appointmentId: pendingSchedule.appointmentId,
            bookingType,
            date: pendingSchedule.date,
            end: pendingSchedule.end,
            eventType: "rescheduled",
            priority: request?.priority,
            requestId: currentAppointment?.requestId,
            start: pendingSchedule.start,
            technicianId: pendingSchedule.technicianId,
            payload: {
              travel: pendingSchedule.travel,
            },
          });
        }
      } catch (error) {
        setToast(
          liveSchedule ? liveScheduleErrorMessage(error) : testSyncErrorMessage(error),
        );
        return;
      }

      const movedAppointments = moveAppointment({
        appointmentId: pendingSchedule.appointmentId,
        appointments: dashboard.appointments,
        bookingType,
        date: pendingSchedule.date,
        durationMinutes:
          minutesFromTime(pendingSchedule.end) -
          minutesFromTime(pendingSchedule.start),
        noteTimeMinutes: bookingTiming(
          pendingSchedule.durationMinutes,
          bookingType,
        ).noteTimeMinutes,
        start: pendingSchedule.start,
        technicianId: pendingSchedule.technicianId,
        travel: pendingSchedule.travel,
        workDurationMinutes: pendingSchedule.durationMinutes,
      });

      setDashboard((current) => ({
        ...current,
        appointments: movedAppointments.map((appointment) =>
          appointment.id === pendingSchedule.appointmentId
            ? {
                ...appointment,
                outlookEventId: liveEvent?.id ?? appointment.outlookEventId,
                outlookWebLink: liveEvent?.webLink ?? appointment.outlookWebLink,
                readOnly: false,
              }
            : appointment,
        ),
        requests: current.requests.map((request) =>
          request.id ===
          current.appointments.find(
            (appointment) => appointment.id === pendingSchedule.appointmentId,
          )?.requestId
            ? {
                ...request,
                bookingType,
                onsite: bookingType === "Onsite",
                technicianId: pendingSchedule.technicianId,
                scheduledStart: mockIsoTime(
                  pendingSchedule.date,
                  pendingSchedule.start,
                ),
                scheduledEnd: mockIsoTime(
                  pendingSchedule.date,
                  pendingSchedule.end,
                ),
              }
            : request,
        ),
      }));
      setSelection({
        kind: "appointment",
        appointmentId: pendingSchedule.appointmentId,
      });
      setToast(
        liveSchedule
          ? "Appointment moved in MSP Central and Outlook."
          : "Appointment moved in mock mode.",
      );
    }

    setPendingSchedule(undefined);
  }

  async function syncSelectedCalendarEvent() {
    if (
      !selectedAppointment ||
      !selectedRequest ||
      !canUseLiveSchedule(dashboard, selectedRequest)
    ) {
      return;
    }

    try {
      const liveEvent = await publishLiveSchedule({
        bookingType:
          selectedAppointment.bookingType ?? bookingTypeForRequest(selectedRequest),
        customer: selectedRequest.customer,
        date: selectedAppointment.date ?? selectedDateKey,
        end: selectedAppointment.end,
        eventId: selectedAppointment.outlookEventId,
        location: selectedRequest.siteAddress ?? selectedRequest.site,
        requestId: selectedRequest.id,
        requestNumber: selectedRequest.requestNumber,
        start: selectedAppointment.start,
        subject: selectedRequest.subject,
        technicianName: technicianLabel(
          dashboard.technicians,
          selectedAppointment.technicianId,
        ),
        technicianEmail: technicianMspCentralIdentity(
          dashboard.technicians,
          selectedAppointment.technicianId,
        ),
        userPrincipalName: technicianOutlookIdentity(
          dashboard.technicians,
          selectedAppointment.technicianId,
        ),
      });

      setDashboard((current) => ({
        ...current,
        appointments: current.appointments.map((appointment) =>
          appointment.id === selectedAppointment.id
            ? {
                ...appointment,
                outlookEventId: liveEvent.id ?? appointment.outlookEventId,
                outlookWebLink: liveEvent.webLink ?? appointment.outlookWebLink,
                readOnly: false,
                status: "confirmed",
              }
            : appointment,
        ),
      }));
      setToast(`${selectedRequest.requestNumber} synced to MSP Central and Outlook.`);
    } catch (error) {
      setToast(liveScheduleErrorMessage(error));
    }
  }

  return (
    <main
      className="cc-density-compact h-screen overflow-hidden bg-cc-canvas text-slate-100"
      data-density="compact"
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <CommandHeader
          authDisabled={authDisabled}
          calendarStatusLabel={dashboard.calendarStatusLabel}
          date={selectedDateLabel}
          dateKey={selectedDateKey}
          technicians={dashboard.technicians}
          timezone={dashboard.timezone}
          viewMode={viewMode}
          searchValue={topSearch}
          onClearSearch={() => setTopSearch("")}
          onDateChange={(dateKey) => clearSelectionForDateChange(dateKey)}
          onNextDay={() =>
            clearSelectionForDateChange(addDaysToDateKey(selectedDateKey, 1))
          }
          onPreviousDay={() =>
            clearSelectionForDateChange(addDaysToDateKey(selectedDateKey, -1))
          }
          onToday={() => clearSelectionForDateChange(todayDateKey())}
          onSearchChange={setTopSearch}
          onViewModeChange={(mode) => setViewMode(mode)}
        />

        <section className="shrink-0 px-3 pb-2 pt-2">
          <div className="rounded-lg border border-white/10 bg-cc-surface-1 p-2.5 shadow-xl">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-cc-orange">
                  Health
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-3">
                  <h2 className="text-base font-semibold">Dispatch Health</h2>
                  {activeHealthItem ? (
                    <span className="rounded-full border border-cc-orange/25 bg-cc-orange/10 px-2 py-0.5 text-[11px] font-semibold text-cc-orange">
                      {healthLabel(activeHealthItem)}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <p className="text-right text-xs text-slate-500">
                  {viewMode === "week" ? "This week" : selectedDateLabel} /{" "}
                  {DISPATCH_TIMEZONE}
                </p>
                {filtersActive ? (
                  <button
                    className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-cc-orange/30 hover:text-cc-orange"
                    type="button"
                    onClick={clearAllFilters}
                  >
                    Clear filters
                  </button>
                ) : null}
                <button
                  aria-expanded={showMoreHealth}
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${
                    secondaryHealthActive
                      ? "border-cc-orange/40 bg-cc-orange/12 text-cc-orange"
                      : "border-white/10 bg-white/[0.04] text-slate-300 hover:border-white/25 hover:text-slate-100"
                  }`}
                  type="button"
                  onClick={() => setShowMoreHealth((open) => !open)}
                >
                  More Health
                  {secondaryIssueCount > 0 ? (
                    <span className="rounded-full bg-amber-300/15 px-1.5 py-0.5 text-[10px] text-amber-100">
                      {secondaryIssueCount}
                    </span>
                  ) : null}
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition ${
                      showMoreHealth ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </div>
            </div>
            <HealthGrid
              activeKey={activeHealth}
              items={primaryHealthItems}
              onSelect={(key) =>
                setActiveHealth((current) => (current === key ? undefined : key))
              }
            />
            {showMoreHealth ? (
              <div className="mt-2 rounded-md border border-white/10 bg-white/[0.025] p-2">
                <HealthGrid
                  activeKey={activeHealth}
                  items={secondaryHealthItems}
                  secondary
                  onSelect={(key) =>
                    setActiveHealth((current) =>
                      current === key ? undefined : key,
                    )
                  }
                />
              </div>
            ) : null}
            {activeFilterSummary ? (
              <p className="mt-2 text-xs text-slate-400">
                Filtered by: {activeFilterSummary}
              </p>
            ) : null}
          </div>
        </section>

        {/* TODO: Future /dispatch/wallboard can reuse this viewport shell, hide side panels, and give the timeline the full wall display width. */}
        <section className="grid min-h-0 flex-1 grid-cols-[minmax(280px,320px)_minmax(720px,1fr)_minmax(320px,360px)] gap-3 px-3 pb-3 max-[1500px]:grid-cols-[280px_minmax(640px,1fr)_320px]">
          <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-cc-surface-1 shadow-xl">
            <div className="shrink-0 border-b border-white/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Queue
              </p>
              <div className="mt-1 flex items-center justify-between">
                <h2 className="text-base font-semibold">
                  Unscheduled Requests
                </h2>
                <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-xs font-semibold text-amber-100">
                  {filtersActive
                    ? `${filteredQueueRequests.length} of ${queueRequests.length}`
                    : unscheduledRequests.length}
                </span>
              </div>
              <label className="mt-2 flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-slate-300 focus-within:border-cc-orange/40">
                <Search className="h-4 w-4" />
                <input
                  className="min-w-0 flex-1 bg-transparent text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none"
                  placeholder="Search requests"
                  type="search"
                  value={queueSearch}
                  onChange={(event) => setQueueSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setQueueSearch("");
                    }
                  }}
                />
                {queueSearch ? (
                  <button
                    aria-label="Clear request search"
                    className="rounded p-0.5 text-slate-500 hover:text-slate-200"
                    type="button"
                    onClick={() => setQueueSearch("")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </label>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <QueueFilterMenu
                  activeValue={queueFilters.technician}
                  filterKey="technician"
                  label="Technician"
                  openKey={openQueueFilter}
                  options={technicianFilterOptions(dashboard.technicians)}
                  onOpenChange={setOpenQueueFilter}
                  onSelect={(value) =>
                    setQueueFilters((current) => ({
                      ...current,
                      technician: value,
                    }))
                  }
                />
                <QueueFilterMenu
                  activeValue={queueFilters.status}
                  filterKey="status"
                  label="Status"
                  openKey={openQueueFilter}
                  options={statusFilterOptions()}
                  onOpenChange={setOpenQueueFilter}
                  onSelect={(value) =>
                    setQueueFilters((current) => ({
                      ...current,
                      status: value,
                    }))
                  }
                />
                <QueueFilterMenu
                  activeValue={queueFilters.priority}
                  filterKey="priority"
                  label="Priority"
                  openKey={openQueueFilter}
                  options={priorityFilterOptions()}
                  onOpenChange={setOpenQueueFilter}
                  onSelect={(value) =>
                    setQueueFilters((current) => ({
                      ...current,
                      priority: value,
                    }))
                  }
                />
                <QueueFilterMenu
                  activeValue={queueFilters.sla}
                  filterKey="sla"
                  label="SLA risk"
                  openKey={openQueueFilter}
                  options={slaFilterOptions()}
                  onOpenChange={setOpenQueueFilter}
                  onSelect={(value) =>
                    setQueueFilters((current) => ({
                      ...current,
                      sla: value,
                    }))
                  }
                />
              </div>
              {activeHealthItem ? (
                <div className="mt-2 flex items-center justify-between rounded-md border border-cc-orange/20 bg-cc-orange/10 px-2.5 py-1.5 text-xs text-cc-orange">
                  <span className="font-semibold">
                    Health filter: {healthLabel(activeHealthItem)}
                  </span>
                  <button
                    className="rounded px-1.5 py-0.5 font-semibold text-cc-orange hover:bg-white/10"
                    type="button"
                    onClick={() => setActiveHealth(undefined)}
                  >
                    Clear
                  </button>
                </div>
              ) : null}
            </div>
            <div
              className="min-h-0 flex-1 space-y-1.5 overflow-auto p-2.5"
              data-testid="request-queue"
            >
              {filteredQueueRequests.length === 0 ? (
                <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-6 text-center text-sm font-semibold text-slate-400">
                  {queueEmptyText}
                </div>
              ) : null}
              {filteredQueueRequests.slice(0, 15).map((request) => (
                <RequestQueueCard
                  key={request.id}
                  active={
                    selection.kind === "request" &&
                    selection.requestId === request.id
                  }
                  hasUnreadUpdate={hasUnreadTicketUpdate(
                    request,
                    seenTicketUpdateIds,
                  )}
                  mergeEnabled={
                    request.sourceSystem === "msp-central" ||
                    request.sourceSystem === "msp-central-fixture"
                  }
                  request={request}
                  technician={technicianLabel(dashboard.technicians, request.technicianId)}
                  onDragEnd={endDrag}
                  onDragStart={() =>
                    beginDrag({ kind: "request", requestId: request.id })
                  }
                  onMerge={() => setMergeRequestId(request.id)}
                  onSelect={() => selectRequest(request.id)}
                />
              ))}
            </div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-cc-surface-1 shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2.5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Schedule
                </p>
                <h2 className="text-base font-semibold">
                  {viewMode === "week"
                    ? "Weekly planner"
                    : "Technician timeline"}
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  {viewMode === "week"
                    ? `${weekDays[0]?.shortLabel} - ${weekDays[6]?.shortLabel}`
                    : "9:00 AM - 5:00 PM"}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-300">
                <Legend color="bg-sky-400" label="Scheduled" />
                <Legend color="bg-amber-400" label="Warning" />
                <Legend color="bg-rose-500" label="Conflict" />
              </div>
            </div>
            {viewMode === "week" ? (
              <WeekPlanner
                appointments={weekAppointments}
                dragPayload={dragPayload}
                requests={dashboard.requests}
                seenTicketUpdateIds={seenTicketUpdateIds}
                selectedAppointmentId={
                  selection.kind === "appointment"
                    ? selection.appointmentId
                    : undefined
                }
                technicians={dashboard.technicians}
                todayDateKey={weekTodayDateKey}
                weekDays={weekDays}
                onBeginAppointmentDrag={(appointmentId) =>
                  beginDrag({ kind: "appointment", appointmentId })
                }
                onDateOpen={(dateKey) =>
                  clearSelectionForDateChange(dateKey, "day")
                }
                onDragEnd={endDrag}
                onWeekDrop={handleWeekDrop}
                onSelectAppointment={selectAppointment}
              />
            ) : (
              <TimelineBoard
                appointments={dayAppointments}
                currentTimeIndicator={currentTimeIndicator}
                dragPayload={dragPayload}
                dropPreview={dropPreview}
                globalSearch={topSearch}
                activeHealth={activeHealth}
                requests={dashboard.requests}
                seenTicketUpdateIds={seenTicketUpdateIds}
                selectedAppointmentId={
                  selection.kind === "appointment"
                    ? selection.appointmentId
                    : undefined
                }
                technicians={dashboard.technicians}
                onBeginAppointmentDrag={(appointmentId) =>
                  beginDrag({ kind: "appointment", appointmentId })
                }
                onDragEnd={endDrag}
                onTimelineDrop={handleTimelineDrop}
                onTimelineHover={handleTimelineHover}
                onSelectAppointment={selectAppointment}
              />
            )}
            {dashboard.calendarError ? (
              <div className="border-t border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-50">
                {dashboard.calendarError}
              </div>
            ) : null}
          </section>

          <DetailDrawer
            appointment={selectedAppointment}
            calendarWriteEnabled={canUseLiveSchedule(dashboard)}
            onOpenWorkLog={(requestId) => setWorkLogRequestId(requestId)}
            onSyncCalendar={syncSelectedCalendarEvent}
            request={selectedRequest}
            selectionKind={selection.kind}
            technician={technicianLabel(
              dashboard.technicians,
              selectedAppointment?.technicianId ?? fallbackRequest?.technicianId,
            )}
          />
        </section>
        {pendingSchedule ? (
          <ScheduleConfirmModal
            liveSchedule={Boolean(
              pendingRequest && canUseLiveSchedule(dashboard, pendingRequest),
            )}
            pending={pendingSchedule}
            request={pendingRequest}
            technicians={dashboard.technicians}
            onCancel={() => setPendingSchedule(undefined)}
            onConfirm={confirmPendingSchedule}
            onBookingTypeChange={updatePendingBookingType}
            onDurationChange={updatePendingDuration}
            onStartChange={updatePendingStart}
            onTechnicianChange={updatePendingTechnician}
          />
        ) : null}
        {workLogRequestId ? (
          <WorkLogModal
            appointment={dashboard.appointments.find(
              (appointment) => appointment.requestId === workLogRequestId,
            )}
            key={workLogRequestId}
            liveWriteback={
              dashboard.dispatchDataSource === "msp-central" &&
              dashboard.requests.find(
                (request) => request.id === workLogRequestId,
              )?.sourceSystem === "msp-central"
            }
            onCancel={() => setWorkLogRequestId(undefined)}
            onSave={saveWorkLog}
            request={dashboard.requests.find(
              (request) => request.id === workLogRequestId,
            )}
            technician={technicianLabel(
              dashboard.technicians,
              dashboard.requests.find((request) => request.id === workLogRequestId)
                ?.technicianId,
            )}
          />
        ) : null}
        {mergeRequestId ? (
          <MergeRequestModal
            childRequest={dashboard.requests.find(
              (request) => request.id === mergeRequestId,
            )}
            requests={dashboard.requests}
            onCancel={() => setMergeRequestId(undefined)}
            onConfirm={mergeRequestIntoParent}
          />
        ) : null}
        {toast ? (
          <div className="fixed bottom-5 right-5 z-50 rounded-md border border-emerald-300/30 bg-emerald-400/15 px-4 py-3 text-sm font-semibold text-emerald-50 shadow-2xl">
            <button
              aria-label="Dismiss notification"
              className="ml-3 text-emerald-100/80"
              type="button"
              onClick={() => setToast(undefined)}
            >
              {toast}
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

async function publishDispatchTestSyncEvent(
  event: DispatchTestSyncEventPayload,
) {
  const response = await fetch("/api/internal/dispatch/test-sync/events", {
    body: JSON.stringify(event),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(body?.error ?? "Dispatcher test sync failed.");
  }
}

async function publishLiveSchedule(event: {
  bookingType?: BookingType;
  customer: string;
  date: string;
  end: string;
  eventId?: string;
  location: string;
  requestId: string;
  requestNumber: string;
  start: string;
  subject: string;
  technicianName: string;
  technicianEmail?: string;
  userPrincipalName: string;
}): Promise<LiveScheduleResult> {
  const response = await fetch("/api/internal/dispatch/live-schedule", {
    body: JSON.stringify(event),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const body = (await response.json().catch(() => null)) as
    | { error?: string; event?: LiveScheduleResult }
    | null;

  if (!response.ok) {
    throw new Error(body?.error ?? "Live schedule write failed.");
  }

  return body?.event ?? {};
}

async function publishMspCentralRequestMerge(event: {
  childRequestId: string;
  parentRequestId: string;
}) {
  const response = await fetch("/api/internal/msp-central/merge-requests", {
    body: JSON.stringify(event),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const body = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new Error(body?.error ?? "MSP Central request merge failed.");
  }
}

async function publishMspCentralWorklog(event: {
  complete: boolean;
  description: string;
  durationMinutes: number;
  endedAt: string;
  requestId: string;
  startedAt: string;
}) {
  const response = await fetch("/api/internal/msp-central/worklogs", {
    body: JSON.stringify(event),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const body = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new Error(body?.error ?? "MSP Central Work Log save failed.");
  }
}

async function loadMspCentralRequestContext(requestId: string) {
  const response = await fetch(
    `/api/internal/msp-central/requests/${encodeURIComponent(requestId)}/context`,
    { cache: "no-store" },
  );
  const body = (await response.json().catch(() => null)) as
    | (MspCentralRequestContext & { error?: string })
    | null;

  if (!response.ok || !body) {
    throw new Error(body?.error ?? "Latest ticket information could not be loaded.");
  }

  return body;
}

function testSyncErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Dispatcher test sync failed.";

  return `Mock schedule did not save: ${message}`;
}

function liveScheduleErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Live schedule write failed.";

  return `Live schedule did not save: ${message}`;
}

function canUseLiveSchedule(
  dashboard: DispatchDashboardData,
  request?: DispatchRequest,
) {
  return (
    request?.sourceSystem === "msp-central" &&
    dashboard.dispatchDataSource === "msp-central" &&
    dashboard.calendarDataSource === "outlook" &&
    dashboard.calendarReadOnly === false
  );
}

function technicianOutlookIdentity(technicians: Technician[], technicianId: string) {
  const technician = technicians.find((candidate) => candidate.id === technicianId);
  const identity =
    technician?.outlookUserPrincipalName ?? technician?.outlookEmail;

  if (!identity) {
    throw new Error("Technician does not have an Outlook calendar identity.");
  }

  return identity;
}

function technicianMspCentralIdentity(
  technicians: Technician[],
  technicianId: string,
) {
  const technician = technicians.find((candidate) => candidate.id === technicianId);

  return technician?.mspCentralEmail ?? technician?.zohoEmail;
}

function MergeRequestModal({
  childRequest,
  onCancel,
  onConfirm,
  requests,
}: {
  childRequest?: DispatchRequest;
  onCancel: () => void;
  onConfirm: (parentRequestId: string) => Promise<void>;
  requests: DispatchRequest[];
}) {
  const [step, setStep] = useState<"search" | "confirm">("search");
  const [search, setSearch] = useState("");
  const [parentRequestId, setParentRequestId] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (!childRequest) {
    return null;
  }

  const normalizedSearch = search.trim().toLowerCase();
  const searchResults = normalizedSearch
    ? requests
        .filter((request) => request.id !== childRequest.id)
        .filter((request) =>
          [
            request.requestNumber,
            request.subject,
            request.customer,
            request.site,
            request.requester,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch),
        )
        .slice(0, 8)
    : [];
  const parentRequest = requests.find(
    (request) => request.id === parentRequestId,
  );

  async function confirmMerge() {
    if (!parentRequest) {
      return;
    }

    setSaving(true);
    setError(undefined);

    try {
      await onConfirm(parentRequest.id);
    } catch (mergeError) {
      setError(
        mergeError instanceof Error
          ? mergeError.message
          : "MSP Central request merge failed.",
      );
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6">
      <section
        aria-label={step === "search" ? "Merge request" : "Confirm request merge"}
        aria-modal="true"
        className="w-full max-w-2xl rounded-lg border border-cc-orange/25 bg-cc-surface-1 p-5 text-slate-100 shadow-2xl"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-cc-orange">
              MSP Central
            </p>
            <h2 className="mt-1 text-xl font-semibold">
              {step === "search" ? "Merge request" : "Confirm request merge"}
            </h2>
          </div>
          <GitMerge className="h-5 w-5 text-cc-orange" />
        </div>

        {step === "search" ? (
          <>
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Duplicate ticket
              </p>
              <MergeRequestSummary request={childRequest} tone="duplicate" />
            </div>

            <label className="mt-4 block text-sm font-semibold text-slate-200">
              Find the surviving parent
              <div className="mt-2 flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 focus-within:border-cc-orange/50">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  autoFocus
                  className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  placeholder="Search request number, subject or customer"
                  type="search"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setParentRequestId(undefined);
                  }}
                />
              </div>
            </label>

            <div className="mt-3 max-h-64 space-y-2 overflow-auto">
              {!normalizedSearch ? (
                <div className="rounded-md border border-dashed border-white/10 px-3 py-6 text-center text-sm text-slate-400">
                  Search the loaded Helpdesk requests.
                </div>
              ) : null}
              {normalizedSearch && searchResults.length === 0 ? (
                <div className="rounded-md border border-dashed border-white/10 px-3 py-6 text-center text-sm text-slate-400">
                  No matching requests
                </div>
              ) : null}
              {searchResults.map((request) => (
                <button
                  key={request.id}
                  aria-label={`Select ${request.requestNumber} as surviving parent`}
                  aria-pressed={parentRequestId === request.id}
                  className={`w-full rounded-md border p-3 text-left transition ${
                    parentRequestId === request.id
                      ? "border-cc-orange/70 bg-cc-orange/12"
                      : "border-white/10 bg-white/[0.03] hover:border-white/25"
                  }`}
                  type="button"
                  onClick={() => setParentRequestId(request.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-xs text-cc-orange">
                        {request.requestNumber}
                      </div>
                      <div className="mt-1 font-semibold text-slate-100">
                        {request.subject}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        {request.customer} / {request.site}
                      </div>
                    </div>
                    <PriorityChip priority={request.priority} />
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200"
                type="button"
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-cc-orange px-4 py-2 text-sm font-semibold text-cc-surface-1 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!parentRequest}
                type="button"
                onClick={() => setStep("confirm")}
              >
                Review merge
              </button>
            </div>
          </>
        ) : parentRequest ? (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-rose-300">
                  Duplicate removed
                </p>
                <MergeRequestSummary request={childRequest} tone="duplicate" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                  Surviving parent
                </p>
                <MergeRequestSummary request={parentRequest} tone="parent" />
              </div>
            </div>

            <div className="mt-4 flex items-start gap-3 rounded-md border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-50">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-semibold">
                  This merge is effectively irreversible.
                </div>
                <p className="mt-1 text-rose-100/80">
                  {childRequest.requestNumber} will disappear and its history will
                  be merged into {parentRequest.requestNumber}.
                </p>
              </div>
            </div>

            {error ? (
              <div className="mt-3 rounded-md border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
                {error}
              </div>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 disabled:opacity-40"
                disabled={saving}
                type="button"
                onClick={() => {
                  setError(undefined);
                  setStep("search");
                }}
              >
                Back
              </button>
              <button
                className="rounded-md bg-rose-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-50"
                disabled={saving}
                type="button"
                onClick={confirmMerge}
              >
                {saving ? "Merging..." : "Merge duplicate into parent"}
              </button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

function MergeRequestSummary({
  request,
  tone,
}: {
  request: DispatchRequest;
  tone: "duplicate" | "parent";
}) {
  return (
    <div
      className={`mt-2 rounded-md border p-3 ${
        tone === "duplicate"
          ? "border-rose-300/20 bg-rose-400/[0.06]"
          : "border-emerald-300/20 bg-emerald-400/[0.06]"
      }`}
    >
      <div className="font-mono text-xs text-cc-orange">
        {request.requestNumber}
      </div>
      <div className="mt-1 font-semibold text-slate-100">{request.subject}</div>
      <div className="mt-1 text-xs text-slate-400">
        {request.customer} / {request.site}
      </div>
    </div>
  );
}

export function ScheduleConfirmModal({
  liveSchedule,
  onCancel,
  onBookingTypeChange,
  onConfirm,
  onDurationChange,
  onStartChange,
  onTechnicianChange,
  pending,
  request,
  technicians,
}: {
  liveSchedule: boolean;
  onCancel: () => void;
  onBookingTypeChange: (bookingType: BookingType) => void;
  onConfirm: () => void;
  onDurationChange: (durationMinutes: number) => void;
  onStartChange: (start: string) => void;
  onTechnicianChange: (technicianId: string) => void;
  pending: PendingSchedule;
  request?: DispatchRequest;
  technicians: Technician[];
}) {
  const technician = technicianLabel(technicians, pending.technicianId);
  const oldTechnician =
    pending.kind === "appointment"
      ? technicianLabel(technicians, pending.oldTechnicianId)
      : undefined;
  const blockedWindow = getAppointmentBlockedWindow({
    id: "pending",
    customer: request?.customer ?? "Pending",
    end: pending.end,
    source: "linked",
    start: pending.start,
    status: "tentative",
    technicianId: pending.technicianId,
    title: request?.subject ?? "Pending appointment",
    travelBackToOfficeMinutes: pending.travel?.travelBackToOfficeMinutes,
    travelToSiteMinutes: pending.travel?.travelToSiteMinutes,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6">
      <section
        aria-modal="true"
        className="w-full max-w-lg rounded-lg border border-cc-orange/20 bg-cc-surface-1 p-5 text-slate-100 shadow-2xl"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-cc-orange">
              {liveSchedule ? "Confirm live schedule" : "Confirm mock schedule"}
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              {pending.kind === "request" ? "Schedule request" : "Move appointment"}
            </h2>
          </div>
          <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-xs font-semibold text-amber-100">
            {liveSchedule ? "MSP Central + Outlook" : "Mock only"}
          </span>
        </div>

        <div className="mt-5 rounded-md border border-white/10 bg-white/[0.03] p-3">
          <div className="font-mono text-xs text-cc-orange">
            {request?.requestNumber ?? "Outlook-only"}
          </div>
          <div className="mt-1 text-base font-semibold">
            {request?.subject ?? "Calendar appointment"}
          </div>
          {request ? (
            <div className="mt-1 text-sm text-slate-300">
              {request.customer} / {request.site}
            </div>
          ) : null}
        </div>

        {pending.kind === "appointment" ? (
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <ScheduleSummary
              label="Current"
              technician={oldTechnician ?? "Unassigned"}
              date={formatSelectedDateLabel(pending.oldDate)}
              time={`${pending.oldStart}-${pending.oldEnd}`}
            />
            <ScheduleSummary
              label="New"
              technician={technician}
              date={formatSelectedDateLabel(pending.date)}
              time={`${pending.start}-${pending.end}`}
            />
          </div>
        ) : (
          <div className="mt-4">
            <ScheduleSummary
              label="New booking"
              technician={technician}
              date={formatSelectedDateLabel(pending.date)}
              time={`${pending.start}-${pending.end}`}
            />
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold text-slate-200">
            Technician
            <select
              className="mt-2 w-full rounded-md border border-white/10 bg-[#111d30] px-3 py-2 text-sm text-slate-100"
              value={pending.technicianId}
              onChange={(event) => onTechnicianChange(event.target.value)}
            >
              {technicians.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-200">
            Start time
            <select
              className="mt-2 w-full rounded-md border border-white/10 bg-[#111d30] px-3 py-2 text-sm text-slate-100"
              value={pending.start}
              onChange={(event) => onStartChange(event.target.value)}
            >
              {scheduleTimeOptions().map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-200">
            Job duration
            <select
              className="mt-2 w-full rounded-md border border-white/10 bg-[#111d30] px-3 py-2 text-sm text-slate-100"
              value={pending.durationMinutes}
              onChange={(event) => onDurationChange(Number(event.target.value))}
            >
              {[30, 60, 90, 120, 150, 180].map((duration) => (
                <option key={duration} value={duration}>
                  {formatDuration(duration)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-200">
            Booking type
            <select
              aria-label="Booking type"
              className="mt-2 w-full rounded-md border border-white/10 bg-[#111d30] px-3 py-2 text-sm text-slate-100"
              value={pending.bookingType}
              onChange={(event) =>
                onBookingTypeChange(event.target.value as BookingType)
              }
            >
              <option value="Remote">Remote</option>
              <option value="Onsite">Onsite</option>
              <option value="In house">In house</option>
            </select>
          </label>
        </div>

        {pending.bookingType === "Onsite" ? (
          <p className="mt-2 text-xs text-slate-400">
            Includes 15 minutes for onsite notes.
          </p>
        ) : null}

        {pending.travel ? (
          <div className="mt-4 rounded-md border border-white/10 bg-white/[0.03] p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Travel
            </div>
            <div className="mt-3 grid gap-2 text-xs">
              <DetailInline label="From" value={pending.travel.officeOriginAddress} />
              <DetailInline
                label="To"
                value={request?.siteAddress || request?.site || "Unknown site"}
              />
              <DetailInline
                label="To site"
                value={`${pending.travel.travelToSiteMinutes} minutes`}
              />
              <DetailInline
                label="Back"
                value={`${pending.travel.travelBackToOfficeMinutes} minutes`}
              />
              <DetailInline
                label="Job time"
                value={`${pending.start}-${pending.end}`}
              />
              <DetailInline
                label="Blocked"
                value={`${blockedWindow.blockedStart}-${blockedWindow.blockedEnd}`}
              />
              <DetailInline
                label="Estimate"
                value={
                  pending.travel.travelWarning ??
                  pending.travel.travelCalculationReason
                }
              />
            </div>
          </div>
        ) : null}

        {pending.warnings.length > 0 ? (
          <div className="mt-4 rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-50">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" />
              Review warnings before confirming
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {pending.warnings.map((warning) => (
                <li key={warning.code}>{warning.message}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-4 rounded-md border border-emerald-300/20 bg-emerald-300/10 p-3 text-sm text-emerald-50">
            No conflicts detected.
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="rounded-md bg-cc-orange px-4 py-2 text-sm font-semibold text-cc-surface-1"
            type="button"
            onClick={onConfirm}
          >
            {liveSchedule ? "Confirm schedule" : "Confirm mock schedule"}
          </button>
        </div>
      </section>
    </div>
  );
}

function WorkLogModal({
  appointment,
  liveWriteback,
  onCancel,
  onSave,
  request,
  technician,
}: {
  appointment?: Appointment;
  liveWriteback: boolean;
  onCancel: () => void;
  onSave: (input: {
    billable: boolean;
    complete: boolean;
    minutes: string;
    notes: string;
    visibility: "external" | "internal";
    workType: string;
  }) => void;
  request?: DispatchRequest;
  technician: string;
}) {
  const resolvedBookingType =
    appointment?.bookingType ??
    request?.bookingType ??
    (request?.onsite === true
      ? "Onsite"
      : request?.onsite === false
        ? "Remote"
        : undefined);
  const chargeableTime = getChargeableTicketTime({
    appointment,
    bookingType: resolvedBookingType,
  });
  const [minutes, setMinutes] = useState(
    String(Math.max(1, chargeableTime.totalMinutes)),
  );
  const [notes, setNotes] = useState("");
  const [visibility, setVisibility] = useState<"external" | "internal">(
    "external",
  );
  const [workType, setWorkType] = useState(
    request?.billable === false ? "non_billable" : "billable",
  );
  const [requestContext, setRequestContext] =
    useState<MspCentralRequestContext>();
  const [contextStatus, setContextStatus] = useState<
    "idle" | "loading" | "loaded" | "failed"
  >(liveWriteback ? "loading" : "idle");
  const [contextError, setContextError] = useState<string>();

  useEffect(() => {
    let active = true;
    if (!liveWriteback || !request?.id) {
      return () => {
        active = false;
      };
    }

    loadMspCentralRequestContext(request.id)
      .then((context) => {
        if (!active) return;
        setRequestContext(context);
        setContextStatus("loaded");
      })
      .catch((error) => {
        if (!active) return;
        setContextStatus("failed");
        setContextError(
          error instanceof Error
            ? error.message
            : "Latest ticket information could not be loaded.",
        );
      });

    return () => {
      active = false;
    };
  }, [liveWriteback, request?.id]);

  if (!request) {
    return null;
  }

  const latestRequest = requestContext?.request ?? request;

  const scheduledTime = appointment
    ? `${appointment.start}-${appointment.end}`
    : request.scheduledStart
      ? `${formatTime(request.scheduledStart)}-${formatTime(request.scheduledEnd ?? request.scheduledStart)}`
      : "Not scheduled";
  const bookingType = resolvedBookingType ?? "Not set";
  const billable = workType === "billable";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4">
      <section
        aria-labelledby="work-log-title"
        aria-modal="true"
        className="flex h-[96vh] w-[96vw] max-w-[1600px] flex-col overflow-hidden rounded-lg border border-cc-orange/20 bg-cc-surface-1 text-slate-100 shadow-2xl"
        data-layout="full-screen-split"
        role="dialog"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-cc-orange">
              {liveWriteback ? "MSP Central" : "Mock/test-sync only"}
            </p>
            <h2 id="work-log-title" className="mt-2 text-xl font-semibold">
              Work Log
            </h2>
          </div>
          <button
            aria-label="Close Work Log"
            className="rounded-md border border-white/10 bg-white/5 p-2 text-slate-200"
            type="button"
            onClick={onCancel}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
        <section
          aria-label="Ticket information"
          className="min-h-0 overflow-y-auto p-4 sm:p-5"
        >
        <section className="rounded-md border border-white/10 bg-white/[0.03] p-4">
          <h3 className="text-sm font-semibold text-slate-50">
            Latest job information
          </h3>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <DetailInline label="Request number" value={latestRequest.requestNumber} />
            <DetailInline label="Subject" value={latestRequest.subject} />
            <DetailInline
              label="Customer/site"
              value={`${latestRequest.customer} / ${latestRequest.site}`}
            />
            <DetailInline label="Status" value={latestRequest.status} />
            <DetailInline label="Priority" value={latestRequest.priority} />
            <DetailInline label="Technician" value={technician} />
            <DetailInline label="Scheduled time" value={scheduledTime} />
            <DetailInline
              label="Due time"
              value={formatDateTime(latestRequest.dueAt)}
            />
            <DetailInline label="Booking type" value={bookingType} />
            {chargeableTime.travelMinutes > 0 ? (
              <DetailInline
                label="Chargeable time"
                value={`${chargeableTime.jobMinutes} min job + ${chargeableTime.travelMinutes} min travel = ${chargeableTime.totalMinutes} min`}
              />
            ) : null}
            <DetailInline
              label="Contact"
              value={`${latestRequest.requester} / ${latestRequest.contact}`}
            />
            <DetailInline
              label="Site/address"
              value={latestRequest.siteAddress || latestRequest.site}
            />
          </div>

          <div className="mt-4 border-t border-white/10 pt-4">
            <h4 className="text-xs font-semibold uppercase text-slate-300">
              Job description
            </h4>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-slate-100">
              {latestRequest.notes ?? "No job description is recorded in MSP Central."}
            </p>
          </div>

          {contextStatus === "loading" ? (
            <p className="mt-4 text-xs text-slate-400">
              Loading latest customer responses and notes...
            </p>
          ) : null}
          {contextStatus === "failed" ? (
            <p className="mt-4 rounded-md border border-amber-300/20 bg-amber-300/10 p-3 text-xs text-amber-50">
              {contextError}
            </p>
          ) : null}
          {requestContext ? (
            <div className="mt-4 grid gap-4">
              <TicketUpdateList
                emptyLabel="No previous work logs are recorded."
                title="Previous work logs"
                updates={requestContext.worklogs ?? []}
                warning={requestContext.worklogsWarning}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <TicketUpdateList
                  emptyLabel="No customer responses are recorded."
                  title="Customer responses"
                  updates={requestContext.customerResponses}
                />
                <TicketUpdateList
                  emptyLabel="No technician or internal notes are recorded."
                  title="Internal notes"
                  updates={requestContext.internalNotes}
                  warning={requestContext.notesWarning}
                />
              </div>
            </div>
          ) : null}
        </section>
        </section>

        <section
          aria-label="Work Log entry"
          className="min-h-0 overflow-y-auto border-t border-white/10 bg-black/10 p-4 lg:border-l lg:border-t-0 sm:p-5"
        >
        <div className="grid gap-4">
          <label className="block text-sm font-semibold text-slate-200">
            Work Log notes
            <textarea
              aria-label="Work Log notes"
              className="mt-2 min-h-28 w-full rounded-md border border-white/10 bg-[#111d30] px-3 py-2 text-sm text-slate-100"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-200">
              Time spent
              <input
                aria-label="Time spent"
                className="mt-2 w-full rounded-md border border-white/10 bg-[#111d30] px-3 py-2 text-sm text-slate-100"
                min="0"
                placeholder="Minutes"
                type="number"
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
              />
            </label>
            <label className="block text-sm font-semibold text-slate-200">
              Work type
              <select
                aria-label="Work type"
                className="mt-2 w-full rounded-md border border-white/10 bg-[#111d30] px-3 py-2 text-sm text-slate-100"
                value={workType}
                onChange={(event) => {
                  const nextWorkType = event.target.value;
                  setWorkType(nextWorkType);

                  if (nextWorkType === "billable") {
                    setVisibility("external");
                  } else if (nextWorkType === "internal") {
                    setVisibility("internal");
                  }
                }}
              >
                <option value="billable">Billable</option>
                <option value="non_billable">Non-billable</option>
                <option value="internal">Internal</option>
              </select>
            </label>
          </div>

          <fieldset className="rounded-md border border-white/10 p-3">
            <legend className="px-1 text-sm font-semibold text-slate-200">
              Visibility
            </legend>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  aria-label="Customer-facing"
                  checked={visibility === "external"}
                  disabled={workType === "internal"}
                  name="worklog-visibility"
                  type="radio"
                  value="external"
                  onChange={() => setVisibility("external")}
                />
                Customer-facing
              </label>
              <label className="flex items-center gap-2">
                <input
                  aria-label="Internal"
                  checked={visibility === "internal"}
                  disabled={workType === "billable"}
                  name="worklog-visibility"
                  type="radio"
                  value="internal"
                  onChange={() => setVisibility("internal")}
                />
                Internal
              </label>
            </div>
          </fieldset>

        </div>

        <div className="mt-5 rounded-md border border-amber-300/20 bg-amber-300/10 p-3 text-xs text-amber-50">
          {liveWriteback
            ? "Saving writes this Work Log and its charged time to MSP Central. Onsite travel is included in the ticket time."
            : "This request is not a live MSP Central ticket. The Work Log remains local/test-sync only."}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="rounded-md border border-cc-orange/30 bg-cc-orange/10 px-4 py-2 text-sm font-semibold text-cc-orange"
            type="button"
            onClick={() =>
              onSave({ billable, complete: false, minutes, notes, visibility, workType })
            }
          >
            Save Work Log
          </button>
          <button
            className="rounded-md bg-cc-orange px-4 py-2 text-sm font-semibold text-cc-surface-1"
            type="button"
            onClick={() =>
              onSave({ billable, complete: true, minutes, notes, visibility, workType })
            }
          >
            Save and complete ticket
          </button>
        </div>
        </section>
        </div>
      </section>
    </div>
  );
}

function ScheduleSummary({
  date,
  label,
  technician,
  time,
}: {
  date: string;
  label: string;
  technician: string;
  time: string;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-2 font-mono text-sm font-semibold text-cc-orange">
        {time}
      </div>
      <div className="mt-1 text-xs text-slate-400">{date}</div>
      <div className="mt-1 text-sm text-slate-200">{technician}</div>
    </div>
  );
}

export function ReadOnlyDispatchCalendar({
  data,
  dateKey,
  now,
  viewMode,
}: {
  data: DispatchDashboardData;
  dateKey: string;
  now: Date;
  viewMode: ViewMode;
}) {
  const weekDays = useMemo(() => getWeekRange(dateKey), [dateKey]);
  const dayAppointments = useMemo(
    () => appointmentsForDate(data.appointments, dateKey),
    [data.appointments, dateKey],
  );
  const weekAppointments = useMemo(
    () =>
      appointmentsForRange(
        data.appointments,
        weekDays.map((day) => day.dateKey),
      ),
    [data.appointments, weekDays],
  );
  const currentTimeIndicator = useMemo(
    () => getCurrentTimeIndicator(dateKey, now),
    [dateKey, now],
  );
  const weekToday = useMemo(
    () => getWeekTodayDateKey(weekDays, now),
    [now, weekDays],
  );
  const seenUpdates = useMemo(() => new Set<string>(), []);
  const ignoreAppointment = () => undefined;
  const ignoreDrop = () => undefined;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/10 bg-cc-surface-1 shadow-xl">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2">
        <div>
          <p className="text-[10px] font-semibold uppercase text-slate-400">
            Schedule
          </p>
          <h2 className="text-base font-semibold">
            {viewMode === "week" ? "Weekly planner" : "Technician timeline"}
          </h2>
          <p className="text-[11px] text-slate-400">
            {viewMode === "week"
              ? `${weekDays[0]?.shortLabel} - ${weekDays[6]?.shortLabel}`
              : "9:00 AM - 5:00 PM"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-300">
          <Legend color="bg-sky-400" label="Scheduled" />
          <Legend color="bg-amber-400" label="Warning" />
          <Legend color="bg-rose-500" label="Conflict" />
        </div>
      </div>
      <div className="pointer-events-none flex min-h-0 flex-1 flex-col">
        {viewMode === "week" ? (
          <WeekPlanner
            appointments={weekAppointments}
            readOnly
            requests={data.requests}
            seenTicketUpdateIds={seenUpdates}
            technicians={data.technicians}
            todayDateKey={weekToday}
            weekDays={weekDays}
            onBeginAppointmentDrag={ignoreAppointment}
            onDateOpen={ignoreAppointment}
            onDragEnd={ignoreAppointment}
            onSelectAppointment={ignoreAppointment}
            onWeekDrop={ignoreDrop}
          />
        ) : (
          <TimelineBoard
            appointments={dayAppointments}
            currentTimeIndicator={currentTimeIndicator}
            globalSearch=""
            requests={data.requests}
            seenTicketUpdateIds={seenUpdates}
            stackOverlaps
            technicians={data.technicians}
            onBeginAppointmentDrag={ignoreAppointment}
            onDragEnd={ignoreAppointment}
            onSelectAppointment={ignoreAppointment}
            onTimelineDrop={ignoreDrop}
            onTimelineHover={ignoreDrop}
          />
        )}
      </div>
      {data.calendarError ? (
        <div className="border-t border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-50">
          {data.calendarError}
        </div>
      ) : null}
    </section>
  );
}

function CommandHeader({
  authDisabled,
  calendarStatusLabel,
  date,
  dateKey,
  searchValue,
  onClearSearch,
  onDateChange,
  onNextDay,
  onPreviousDay,
  onSearchChange,
  onToday,
  onViewModeChange,
  technicians,
  timezone,
  viewMode,
}: {
  authDisabled: boolean;
  calendarStatusLabel?: string;
  date: string;
  dateKey: string;
  searchValue: string;
  onClearSearch: () => void;
  onDateChange: (dateKey: string) => void;
  onNextDay: () => void;
  onPreviousDay: () => void;
  onSearchChange: (value: string) => void;
  onToday: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  technicians: Technician[];
  timezone: string;
  viewMode: ViewMode;
}) {
  return (
    <header className="border-b border-cc-border bg-cc-surface-1 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <CommandCentreLogo
            className="h-12 w-12 shrink-0 object-contain"
            decorative
            priority
            variant="icon-colour"
          />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">
                Command Centre
              </h1>
              <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-xs font-semibold text-amber-100/90">
                {calendarStatusLabel ?? "Mock Mode"}
              </span>
              <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-0.5 text-xs font-semibold text-emerald-100">
                Connected
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-300">
              <CalendarDays className="h-4 w-4 text-cc-orange" />
              <span className="font-semibold text-slate-100">{date}</span>
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs">
                {timezone}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex rounded-md border border-white/10 bg-white/5 p-1">
            {(["day", "week"] as const).map((mode) => (
              <button
                key={mode}
                aria-pressed={viewMode === mode}
                className={`rounded px-2.5 py-1 text-sm font-semibold capitalize ${
                  viewMode === mode
                    ? "bg-cc-orange text-cc-surface-1"
                    : "text-slate-300 hover:bg-white/5"
                }`}
                type="button"
                onClick={() => onViewModeChange(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
          <IconButton label="Previous day" onClick={onPreviousDay}>
            <ChevronLeft className="h-4 w-4" />
          </IconButton>
          <button
            className="rounded-md border border-cc-orange/30 bg-cc-orange/10 px-2.5 py-1.5 text-sm font-semibold text-cc-orange"
            type="button"
            onClick={onToday}
          >
            Today
          </button>
          <IconButton label="Next day" onClick={onNextDay}>
            <ChevronRight className="h-4 w-4" />
          </IconButton>
          <input
            aria-label="Select dispatch date"
            className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm font-semibold text-slate-100 [color-scheme:dark]"
            type="date"
            value={dateKey}
            onChange={(event) => onDateChange(event.target.value)}
          />
          <label className="flex min-w-[220px] items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-slate-400 focus-within:border-cc-orange/40">
            <Search className="h-4 w-4" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none"
              placeholder="Search Command Centre"
              type="search"
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  onClearSearch();
                }
              }}
            />
            {searchValue ? (
              <button
                aria-label="Clear Command Centre search"
                className="rounded p-0.5 text-slate-500 hover:text-slate-200"
                type="button"
                onClick={onClearSearch}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
          <PresenceControls technicians={technicians} />
          <Link
            className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm font-semibold text-slate-200 hover:border-cc-orange/40 hover:bg-cc-orange/10"
            href="/calls"
          >
            <PhoneCall className="h-4 w-4" />
            Calls
          </Link>
          <Link
            className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm font-semibold text-slate-200 hover:border-cc-orange/40 hover:bg-cc-orange/10"
            href="/wallboard"
          >
            <Monitor className="h-4 w-4" />
            Wallboard
          </Link>
          {authDisabled ? null : (
            <button
              className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm font-semibold text-slate-200"
              type="button"
              onClick={() => signOut({ callbackUrl: "/auth/sign-in" })}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function HealthGrid({
  activeKey,
  items,
  onSelect,
  secondary = false,
}: {
  activeKey?: string;
  items: HealthItem[];
  secondary?: boolean;
  onSelect: (key: string) => void;
}) {
  return (
    <div
      className={`grid gap-2 ${
        secondary
          ? "grid-cols-2 md:grid-cols-3 xl:grid-cols-6"
          : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
      }`}
    >
      {items.map((item) => (
        <button
          key={item.key}
          aria-label={`${healthLabel(item)} ${item.count}`}
          aria-pressed={activeKey === item.key}
          className={healthCardClass(item, activeKey === item.key)}
          type="button"
          onClick={() => onSelect(item.key)}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-[10px] font-bold uppercase leading-3 tracking-wide opacity-95">
              {healthLabel(item)}
            </p>
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 opacity-55" />
          </div>
          <p className="mt-1 text-[26px] font-bold leading-none tabular-nums">
            {item.count}
          </p>
        </button>
      ))}
    </div>
  );
}

function QueueFilterMenu({
  activeValue,
  filterKey,
  label,
  onOpenChange,
  onSelect,
  openKey,
  options,
}: {
  activeValue?: string;
  filterKey: QueueFilterKey;
  label: string;
  onOpenChange: (key?: QueueFilterKey) => void;
  onSelect: (value?: string) => void;
  openKey?: QueueFilterKey;
  options: { label: string; value?: string }[];
}) {
  const open = openKey === filterKey;
  const activeLabel =
    options.find((option) => option.value === activeValue)?.label ?? label;

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-xs transition ${
          activeValue
            ? "border-cc-orange/35 bg-cc-orange/10 text-cc-orange"
            : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25"
        }`}
        type="button"
        onClick={() => onOpenChange(open ? undefined : filterKey)}
      >
        <span className="truncate">
          {activeValue ? `${label}: ${activeLabel}` : label}
        </span>
        <Filter className="h-3.5 w-3.5 shrink-0 text-slate-500" />
      </button>
      {open ? (
        <div className="absolute left-0 top-[calc(100%+4px)] z-50 w-full min-w-[160px] rounded-md border border-white/10 bg-cc-surface-2 p-1 shadow-2xl">
          {options.map((option) => (
            <button
              key={option.value ?? "all"}
              aria-pressed={activeValue === option.value}
              className={`w-full rounded px-2 py-1 text-left text-xs transition ${
                activeValue === option.value
                  ? "bg-cc-orange/15 text-cc-orange"
                  : "text-slate-300 hover:bg-white/5"
              }`}
              type="button"
              onClick={() => {
                onSelect(option.value);
                onOpenChange(undefined);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RequestQueueCard({
  active,
  hasUnreadUpdate,
  mergeEnabled,
  onDragEnd,
  onDragStart,
  onMerge,
  onSelect,
  request,
  technician,
}: {
  active: boolean;
  hasUnreadUpdate: boolean;
  mergeEnabled: boolean;
  onDragEnd: () => void;
  onDragStart: () => void;
  onMerge: () => void;
  onSelect: () => void;
  request: DispatchRequest;
  technician: string;
}) {
  return (
    <article
      draggable
      className={`w-full overflow-hidden rounded-md border text-left transition ${
        active
          ? "border-cc-orange/80 bg-cc-orange/15 shadow-[0_0_0_1px_rgba(255,130,58,0.28),0_14px_32px_rgba(255,130,58,0.16)]"
          : "border-white/10 bg-white/[0.04] hover:border-white/25 hover:bg-white/[0.06]"
      }`}
      onDragEnd={onDragEnd}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `request:${request.id}`);
        onDragStart();
      }}
    >
      <button
        aria-label={`${request.requestNumber} ${request.subject}`}
        className="w-full p-2.5 text-left"
        type="button"
        onClick={onSelect}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-mono text-[11px] text-cc-orange">
              {request.requestNumber}
            </div>
            <div className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-slate-50">
              {request.subject}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <PriorityChip priority={request.priority} />
            {hasUnreadUpdate ? (
              <TicketUpdateBadge dataTestId={`queue-ticket-update-${request.id}`} />
            ) : null}
          </div>
        </div>
        <div className="mt-1.5 flex items-center gap-1 text-xs text-slate-400">
          <span>{request.customer}</span>
          {hasDisplayableSite(request.site) ? (
            <>
              <span>/</span>
              <span>{request.site}</span>
            </>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <Badge tone="info">{request.status}</Badge>
          <Badge tone={request.slaState === "normal" ? "muted" : "critical"}>
            {request.slaState === "normal" ? "SLA normal" : "SLA risk"}
          </Badge>
          {request.warnings.slice(0, 2).map((warning) => (
            <Badge key={warning} tone="warning">
              {warning}
            </Badge>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-x-2 text-[11px] text-slate-400">
          <span>Age {request.ageHours}h</span>
          <span className="truncate text-center">{technician}</span>
          <span className="text-right">Due {formatTime(request.dueAt)}</span>
        </div>
      </button>
      {mergeEnabled ? (
        <div className="flex justify-end border-t border-white/[0.07] px-2 py-1">
          <button
            aria-label={`Merge ${request.requestNumber}`}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-slate-400 transition hover:bg-white/[0.06] hover:text-cc-orange"
            draggable={false}
            type="button"
            onClick={onMerge}
          >
            <GitMerge className="h-3.5 w-3.5" />
            Merge
          </button>
        </div>
      ) : null}
    </article>
  );
}

function TicketUpdateList({
  emptyLabel,
  title,
  updates,
  warning,
}: {
  emptyLabel: string;
  title: string;
  updates: MspCentralRequestUpdate[];
  warning?: string;
}) {
  return (
    <section>
      <h4 className="text-xs font-semibold uppercase text-slate-300">{title}</h4>
      {warning ? (
        <p className="mt-2 text-xs text-amber-200">{warning}</p>
      ) : updates.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">{emptyLabel}</p>
      ) : (
        <div className="mt-2 grid max-h-40 gap-2 overflow-auto pr-1">
          {updates.map((update) => (
            <article
              className="rounded-md border border-white/10 bg-[#111d30] p-2"
              key={update.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                <span className="font-semibold text-slate-200">{update.author}</span>
                <span className="flex flex-wrap items-center gap-2">
                  {update.durationMinutes ? (
                    <span>{formatWorklogDuration(update.durationMinutes)}</span>
                  ) : null}
                  {update.createdAt ? <span>{formatDateTime(update.createdAt)}</span> : null}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-100">
                {update.body}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function formatWorklogDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) {
    return `${remainingMinutes}m`;
  }

  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function TimelineBoard({
  activeHealth,
  appointments,
  currentTimeIndicator,
  dragPayload,
  dropPreview,
  globalSearch,
  onBeginAppointmentDrag,
  onDragEnd,
  onSelectAppointment,
  onTimelineDrop,
  onTimelineHover,
  requests,
  seenTicketUpdateIds,
  selectedAppointmentId,
  stackOverlaps = false,
  technicians,
}: {
  activeHealth?: string;
  appointments: Appointment[];
  currentTimeIndicator: CurrentTimeIndicator;
  dragPayload?: DragPayload;
  dropPreview?: DropPreview;
  globalSearch: string;
  onBeginAppointmentDrag: (appointmentId: string) => void;
  onDragEnd: () => void;
  onSelectAppointment: (appointment: Appointment) => void;
  onTimelineDrop: (
    payload: DragPayload,
    technicianId: string,
    start: string,
  ) => void;
  onTimelineHover: (
    payload: DragPayload,
    technicianId: string,
    start: string,
  ) => void;
  requests: DispatchRequest[];
  seenTicketUpdateIds: SeenTicketUpdateIds;
  selectedAppointmentId?: string;
  stackOverlaps?: boolean;
  technicians: Technician[];
}) {
  const markers = timelineMarkers();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [timelineTrackWidth, setTimelineTrackWidth] = useState(
    TIMELINE_TRACK_WIDTH_PX,
  );
  const [timelineViewportHeight, setTimelineViewportHeight] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    function measure() {
      if (!viewport) {
        return;
      }

      const measuredTrackWidth =
        viewport.clientWidth > TECHNICIAN_COLUMN_WIDTH_PX
          ? viewport.clientWidth - TECHNICIAN_COLUMN_WIDTH_PX
          : TIMELINE_TRACK_WIDTH_PX;

      setTimelineTrackWidth(
        Math.max(1, measuredTrackWidth),
      );
      setTimelineViewportHeight(viewport.clientHeight);
    }

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);

      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);

    return () => observer.disconnect();
  }, []);
  const availableRowsHeight = Math.max(
    0,
    timelineViewportHeight - TIMELINE_HEADER_HEIGHT_PX,
  );
  const distributedRowHeight =
    technicians.length > 0
      ? Math.floor(availableRowsHeight / technicians.length)
      : 0;

  return (
    <div
      ref={viewportRef}
      className="min-h-0 flex-1 overflow-hidden"
      data-testid="timeline-viewport"
    >
      <div
        style={{
          width: TECHNICIAN_COLUMN_WIDTH_PX + timelineTrackWidth,
        }}
      >
        <div
          className="grid border-b border-white/10"
          style={{
            gridTemplateColumns: `${TECHNICIAN_COLUMN_WIDTH_PX}px ${timelineTrackWidth}px`,
          }}
        >
          <div className="sticky left-0 z-30 bg-[#0f1b2e] px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 shadow-[8px_0_18px_rgba(0,0,0,0.22)]">
            Technician
          </div>
          <div
            className="relative h-10 bg-[#0f1b2e]"
            style={{ width: timelineTrackWidth }}
          >
            {markers.map((marker) => {
              const showLabel = shouldShowTimelineHourLabel(
                marker.time,
                timelineTrackWidth,
              );

              return (
                <div
                  key={marker.time}
                  className="absolute inset-y-0 border-l border-white/10"
                  style={{
                    left: scaleTimelineX(marker.leftPx, timelineTrackWidth),
                  }}
                >
                  {marker.kind === "end" ? (
                    <span className="absolute right-0 top-3 -translate-x-full whitespace-nowrap pr-3 text-[10px] font-semibold text-slate-400">
                      {marker.label}
                    </span>
                  ) : (
                    <span
                      className={`absolute top-3 whitespace-nowrap text-xs font-semibold text-slate-300 ${
                        marker.time === "17:00"
                          ? "-translate-x-1/2 px-1"
                          : "px-3"
                      } ${showLabel ? "" : "hidden"}`}
                    >
                      {marker.label}
                    </span>
                  )}
                </div>
              );
            })}
            <CurrentTimeHeaderMarker
              indicator={currentTimeIndicator}
              trackWidth={timelineTrackWidth}
            />
          </div>
        </div>
        {technicians.map((technician) => {
          const laneAppointments = appointments.filter(
            (appointment) => appointment.technicianId === technician.id,
          );
          const layout = stackOverlaps
            ? buildStackedTimelineLayout(laneAppointments)
            : buildTimelineLayout(laneAppointments);
          const rowHeight = Math.max(layout.rowHeight, distributedRowHeight);
          const rowExtra = Math.max(0, rowHeight - layout.rowHeight);
          const rowOffset = rowExtra / 2;
          return (
            <div
              key={technician.id}
              className="grid border-b border-white/10"
              style={{
                gridTemplateColumns: `${TECHNICIAN_COLUMN_WIDTH_PX}px ${timelineTrackWidth}px`,
              }}
            >
              <div className="sticky left-0 z-20 bg-[#0d1829] px-3 py-4 shadow-[8px_0_18px_rgba(0,0,0,0.22)]">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-50">
                    {technician.displayName}
                  </h3>
                  {technician.mappingStatus === "mapped" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-300" />
                  )}
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  {technician.storeLocation}
                </p>
                <p className="mt-2 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">
                  {laneAppointments.length} bookings
                </p>
              </div>
              <div
                className={`relative bg-cc-surface-1 ${
                  dragPayload ? "outline outline-1 outline-cc-orange/10" : ""
                }`}
                data-testid="timeline-track"
                style={{ height: rowHeight, width: timelineTrackWidth }}
                onDragLeave={() => {
                  // Keep the last ghost visible while crossing child elements.
                }}
                onDragOver={(event) => {
                  if (!dragPayload) {
                    return;
                  }

                  event.preventDefault();
                  const start = timelinePositionToTime(
                    event.clientX - event.currentTarget.getBoundingClientRect().left,
                    timelineTrackWidth,
                  );
                  onTimelineHover(dragPayload, technician.id, start);
                }}
                onDrop={(event) => {
                  if (!dragPayload) {
                    return;
                  }

                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  const start = timelinePositionToTime(
                    event.clientX - rect.left,
                    timelineTrackWidth,
                  );
                  onTimelineDrop(dragPayload, technician.id, start);
                }}
              >
                <CurrentTimeLaneOverlay
                  indicator={currentTimeIndicator}
                  trackWidth={timelineTrackWidth}
                />
                <div className="absolute inset-0">
                  {markers.map((marker) => (
                    <div
                      key={marker.time}
                      className="absolute inset-y-0 border-l border-white/[0.06]"
                      style={{
                        left: scaleTimelineX(marker.leftPx, timelineTrackWidth),
                      }}
                    />
                  ))}
                </div>
                {layout.items.map((item) =>
                  item.isOverlapGroup ? (
                    <TimelineOverlapGroup
                      key={item.appointment.id}
                      activeAppointmentId={selectedAppointmentId}
                      searchState={appointmentSearchState(
                        item.appointment,
                        globalSearch,
                        activeHealth,
                        requests,
                        technicians,
                      )}
                      item={item}
                      requests={requests}
                      rowOffset={rowOffset}
                      trackWidth={timelineTrackWidth}
                      onBeginAppointmentDrag={onBeginAppointmentDrag}
                      onDragEnd={onDragEnd}
                      onSelectAppointment={onSelectAppointment}
                    />
                  ) : (
                    <TimelineAppointment
                      key={item.appointment.id}
                      active={selectedAppointmentId === item.appointment.id}
                      appointment={item.appointment}
                      cardHeight={item.cardHeight}
                      laneTop={item.laneTop + rowOffset}
                      searchState={appointmentSearchState(
                        item.appointment,
                        globalSearch,
                        activeHealth,
                        requests,
                        technicians,
                      )}
                      request={requests.find(
                        (request) => request.id === item.appointment.requestId,
                      )}
                      hasUnreadUpdate={hasUnreadTicketUpdate(
                        requests.find(
                          (request) => request.id === item.appointment.requestId,
                        ),
                        seenTicketUpdateIds,
                      )}
                      onBeginDrag={() => onBeginAppointmentDrag(item.appointment.id)}
                      onDragEnd={onDragEnd}
                      onSelect={() => onSelectAppointment(item.appointment)}
                      trackWidth={timelineTrackWidth}
                    />
                  ),
                )}
                {dropPreview?.technicianId === technician.id ? (
                  <TimelineDropPreview
                    preview={dropPreview}
                    rowOffset={rowOffset}
                    trackWidth={timelineTrackWidth}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekPlanner({
  appointments,
  dragPayload,
  onBeginAppointmentDrag,
  onDateOpen,
  onDragEnd,
  onSelectAppointment,
  onWeekDrop,
  readOnly = false,
  requests,
  seenTicketUpdateIds,
  selectedAppointmentId,
  technicians,
  todayDateKey,
  weekDays,
}: {
  appointments: Appointment[];
  dragPayload?: DragPayload;
  onBeginAppointmentDrag: (appointmentId: string) => void;
  onDateOpen: (dateKey: string) => void;
  onDragEnd: () => void;
  onSelectAppointment: (appointment: Appointment) => void;
  onWeekDrop: (
    payload: DragPayload,
    technicianId: string,
    dateKey: string,
  ) => void;
  readOnly?: boolean;
  requests: DispatchRequest[];
  seenTicketUpdateIds: SeenTicketUpdateIds;
  selectedAppointmentId?: string;
  technicians: Technician[];
  todayDateKey?: string;
  weekDays: ReturnType<typeof getWeekRange>;
}) {
  const grouped = groupWeekAppointments(appointments, technicians, weekDays);
  const [expandedCell, setExpandedCell] = useState<
    { dateKey: string; technicianId: string } | undefined
  >();
  const expandedTechnician = expandedCell
    ? technicians.find((technician) => technician.id === expandedCell.technicianId)
    : undefined;
  const expandedDay = expandedCell
    ? weekDays.find((day) => day.dateKey === expandedCell.dateKey)
    : undefined;
  const expandedAppointments =
    expandedCell && expandedTechnician && expandedDay
      ? grouped[expandedCell.technicianId]?.[expandedCell.dateKey] ?? []
      : [];

  return (
    <div
      className="min-h-0 flex-1 overflow-hidden"
      data-testid="week-calendar-viewport"
    >
      <div className="w-full">
        <div className="grid grid-cols-[170px_repeat(7,minmax(0,1fr))] border-b border-white/10">
          <div className="sticky left-0 z-30 bg-[#0f1b2e] px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 shadow-[8px_0_18px_rgba(0,0,0,0.22)]">
            Technician
          </div>
          {weekDays.map((day) => {
            const isToday = day.dateKey === todayDateKey;
            return (
            <button
              key={day.dateKey}
              className={`border-l px-2.5 py-2.5 text-left text-xs font-semibold hover:bg-white/[0.04] ${
                isToday
                  ? "border-cc-orange/30 bg-cc-orange/[0.08] text-cc-orange"
                  : "border-white/10 bg-[#0f1b2e] text-slate-200"
              }`}
              type="button"
              onClick={() => onDateOpen(day.dateKey)}
            >
              <span>{day.shortLabel}</span>
              {isToday ? (
                <span className="ml-2 rounded-full border border-cc-orange/30 bg-cc-orange/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-cc-orange">
                  Today
                </span>
              ) : null}
            </button>
            );
          })}
        </div>
        {technicians.map((technician) => (
          <div
            key={technician.id}
            className="grid min-h-[96px] grid-cols-[170px_repeat(7,minmax(0,1fr))] border-b border-white/10"
          >
            <div className="sticky left-0 z-20 bg-[#0d1829] px-3 py-3 shadow-[8px_0_18px_rgba(0,0,0,0.22)]">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-50">
                  {technician.displayName}
                </h3>
                {technician.mappingStatus === "mapped" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-300" />
                )}
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                {technician.storeLocation}
              </p>
              <p className="mt-2 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">
                {appointments.filter((item) => item.technicianId === technician.id).length}{" "}
                week bookings
              </p>
            </div>
            {weekDays.map((day) => {
              const cellAppointments = grouped[technician.id][day.dateKey];
              const visibleAppointments = cellAppointments.slice(0, 1);
              const hiddenAppointments = cellAppointments.slice(1);
              const isToday = day.dateKey === todayDateKey;
              return (
                <div
                  key={`${technician.id}-${day.dateKey}`}
                  className={`relative min-h-[96px] border-l p-1.5 ${
                    isToday
                      ? "border-cc-orange/20 bg-cc-orange/[0.045]"
                      : "border-white/[0.06] bg-cc-surface-1"
                  } ${
                    dragPayload ? "outline outline-1 outline-cc-orange/10" : ""
                  }`}
                  data-testid={`week-cell-${technician.id}-${day.dateKey}`}
                  onDragOver={(event) => {
                    if (!dragPayload) {
                      return;
                    }

                    event.preventDefault();
                  }}
                  onDrop={(event) => {
                    if (!dragPayload) {
                      return;
                    }

                    event.preventDefault();
                    onWeekDrop(dragPayload, technician.id, day.dateKey);
                  }}
                >
                  <div className="space-y-1.5">
                    {visibleAppointments.map((appointment) => (
                      <WeekAppointmentCard
                        key={appointment.id}
                        active={selectedAppointmentId === appointment.id}
                        appointment={appointment}
                        dataTestId="week-appointment-card"
                        request={requests.find(
                          (request) => request.id === appointment.requestId,
                        )}
                        hasUnreadUpdate={hasUnreadTicketUpdate(
                          requests.find(
                            (request) => request.id === appointment.requestId,
                          ),
                          seenTicketUpdateIds,
                        )}
                        onBeginDrag={() => onBeginAppointmentDrag(appointment.id)}
                        onDragEnd={onDragEnd}
                        onSelect={() => onSelectAppointment(appointment)}
                      />
                    ))}
                  </div>
                  {hiddenAppointments.length > 0 ? (
                    <button
                      aria-label={`Show ${hiddenAppointments.length} more ${technician.displayName} bookings on ${day.shortLabel}`}
                      className="mt-1.5 w-full rounded-md border border-cc-orange/20 bg-cc-orange/10 px-2 py-1 text-center text-[11px] font-bold text-cc-orange transition hover:border-cc-orange/45 hover:bg-cc-orange/16"
                      type="button"
                      onClick={() =>
                        setExpandedCell({
                          dateKey: day.dateKey,
                          technicianId: technician.id,
                        })
                      }
                    >
                      +{hiddenAppointments.length}
                    </button>
                  ) : null}
                  {cellAppointments.length === 0 && !readOnly ? (
                    <div className="rounded-md border border-dashed border-white/10 px-2 py-4 text-center text-[11px] text-slate-500">
                      Drop here
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {expandedCell && expandedTechnician && expandedDay ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-6">
          <section
            aria-label={`${expandedTechnician.displayName} bookings on ${expandedDay.shortLabel}`}
            className="max-h-[72vh] w-full max-w-xl overflow-hidden rounded-lg border border-cc-orange/25 bg-cc-surface-1 shadow-2xl"
            data-testid="week-overflow-reveal"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-cc-orange">
                  Week bookings
                </p>
                <h3 className="mt-0.5 text-base font-semibold text-slate-50">
                  {expandedTechnician.displayName} · {expandedDay.shortLabel}
                </h3>
              </div>
              <button
                aria-label="Close week bookings"
                className="rounded-md border border-white/10 bg-white/5 p-1.5 text-slate-200 hover:border-white/25"
                type="button"
                onClick={() => setExpandedCell(undefined)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[calc(72vh-76px)] space-y-2 overflow-auto p-3">
              {expandedAppointments.map((appointment) => (
                <WeekAppointmentCard
                  key={appointment.id}
                  active={selectedAppointmentId === appointment.id}
                  appointment={appointment}
                  dataTestId="week-overflow-appointment"
                  request={requests.find(
                    (request) => request.id === appointment.requestId,
                  )}
                  hasUnreadUpdate={hasUnreadTicketUpdate(
                    requests.find(
                      (request) => request.id === appointment.requestId,
                    ),
                    seenTicketUpdateIds,
                  )}
                  onBeginDrag={() => onBeginAppointmentDrag(appointment.id)}
                  onDragEnd={onDragEnd}
                  onSelect={() => {
                    onSelectAppointment(appointment);
                    setExpandedCell(undefined);
                  }}
                />
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function WeekAppointmentCard({
  active,
  appointment,
  dataTestId,
  hasUnreadUpdate,
  onBeginDrag,
  onDragEnd,
  onSelect,
  request,
}: {
  active: boolean;
  appointment: Appointment;
  dataTestId?: string;
  hasUnreadUpdate: boolean;
  onBeginDrag: () => void;
  onDragEnd: () => void;
  onSelect: () => void;
  request?: DispatchRequest;
}) {
  const warning = Boolean(appointment.syncIssue);
  const priorityClass = bookingCardPriorityClass(request?.priority);

  return (
    <button
      aria-label={`${appointment.title} ${appointment.customer}`}
      aria-pressed={active}
      data-testid={dataTestId}
      draggable={!appointment.readOnly}
      className={`w-full cursor-pointer rounded-md border px-2 py-1.5 text-left text-xs transition hover:-translate-y-0.5 ${
        active
          ? "border-cc-orange bg-cc-orange/22 text-cc-orange ring-2 ring-cc-orange"
          : `${priorityClass} ${warning ? "ring-1 ring-amber-200/70" : ""}`
      }`}
      type="button"
      onClick={onSelect}
      onDragEnd={onDragEnd}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `appointment:${appointment.id}`);
        onBeginDrag();
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1 font-mono text-[11px] font-semibold">
          {appointment.activityType === "external_call" ? (
            <PhoneCall className="h-3 w-3" />
          ) : null}
          {appointment.start}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <SentimentIcon sentiment={request?.sentiment} />
          {hasUnreadUpdate ? (
            <TicketUpdateBadge
              compact
              dataTestId={`week-ticket-update-${appointment.id}`}
            />
          ) : null}
          {warning ? <MailWarning className="h-3.5 w-3.5 shrink-0" /> : null}
        </span>
      </div>
      <div className="mt-1 line-clamp-2 font-semibold leading-snug">
        {appointment.customer}
      </div>
      <div className="mt-1 truncate opacity-90">{appointment.title}</div>
      {appointment.activityType === "external_call" ? (
        <div className="mt-1 text-[10px] font-semibold text-cyan-100">
          {formatTalkTime(appointment.externalTalkSeconds ?? 0)} external talk
        </div>
      ) : null}
      {request ? (
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[10px]">
            {request.requestNumber}
          </span>
          <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold">
            {request.priority}
          </span>
        </div>
      ) : null}
      {(appointment.travelToSiteMinutes ?? 0) > 0 ? (
        <div className="mt-1 rounded-full bg-slate-300/10 px-2 py-0.5 text-[10px] font-semibold text-slate-200">
          Travel {appointment.travelToSiteMinutes}m
        </div>
      ) : null}
    </button>
  );
}

function CurrentTimeHeaderMarker({
  indicator,
  trackWidth,
}: {
  indicator: CurrentTimeIndicator;
  trackWidth: number;
}) {
  if (!indicator.visible) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute top-2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-cc-orange/35 bg-cc-surface-2/95 px-2 py-1 text-[10px] font-semibold text-cc-orange shadow-[0_0_16px_rgba(255,130,58,0.32)]"
      style={{ left: scaleTimelineX(indicator.positionPx, trackWidth) }}
    >
      <span className="uppercase tracking-wide text-cc-orange">Now</span>
      <span className="font-mono text-white">{indicator.label}</span>
    </div>
  );
}

function CurrentTimeLaneOverlay({
  indicator,
  trackWidth,
}: {
  indicator: CurrentTimeIndicator;
  trackWidth: number;
}) {
  if (!indicator.visible) {
    return null;
  }

  return (
    <>
      <div
        data-testid="current-time-elapsed-shade"
        className="pointer-events-none absolute inset-y-0 left-0 z-[2] bg-cc-orange/[0.14] shadow-[inset_-34px_0_42px_rgba(255,130,58,0.12)]"
        style={{ width: scaleTimelineX(indicator.elapsedWidthPx, trackWidth) }}
      />
      <div
        data-testid="current-time-line"
        className="pointer-events-none absolute inset-y-0 z-[12] w-0.5 -translate-x-1/2 bg-cc-orange shadow-[0_0_18px_rgba(255,130,58,0.82)]"
        style={{ left: scaleTimelineX(indicator.positionPx, trackWidth) }}
      />
    </>
  );
}

function TimelineOverlapGroup({
  activeAppointmentId,
  item,
  onBeginAppointmentDrag,
  onDragEnd,
  onSelectAppointment,
  requests,
  rowOffset,
  searchState,
  trackWidth,
}: {
  activeAppointmentId?: string;
  item: TimelineLayoutItem;
  onBeginAppointmentDrag: (appointmentId: string) => void;
  onDragEnd: () => void;
  onSelectAppointment: (appointment: Appointment) => void;
  requests: DispatchRequest[];
  rowOffset: number;
  searchState: SearchState;
  trackWidth: number;
}) {
  const [open, setOpen] = useState(false);
  const frontAppointment = item.appointment;
  const active = item.appointments.some(
    (appointment) => appointment.id === activeAppointmentId,
  );
  const frontRequest = requests.find(
    (request) => request.id === frontAppointment.requestId,
  );
  const groupWidth = timelineWidth(item.groupStart, item.groupEnd, trackWidth);
  const frontLeftWithinGroup =
    timelineLeft(frontAppointment.start, trackWidth) -
    timelineLeft(item.groupStart, trackWidth);
  const frontWidthWithinGroup = timelineWidth(
    frontAppointment.start,
    frontAppointment.end,
    trackWidth,
  );
  const frontPriorityClass = bookingCardPriorityClass(frontRequest?.priority);

  return (
    <div
      className={`absolute z-30 transition ${
        searchState === "dimmed" ? "opacity-35 grayscale" : ""
      } ${searchState === "match" ? "drop-shadow-[0_0_16px_rgba(255,130,58,0.18)]" : ""}`}
      data-search-state={searchState}
      data-testid={`timeline-overlap-${frontAppointment.id}`}
      style={{
        height: item.cardHeight,
        left: timelineLeft(item.groupStart, trackWidth),
        top: item.laneTop + rowOffset,
        width: groupWidth,
      }}
      onFocus={() => setOpen(true)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div className="pointer-events-none absolute inset-0 rounded-lg border border-rose-300/40 bg-rose-400/[0.045] shadow-[0_0_0_1px_rgba(251,113,133,0.14),0_14px_34px_rgba(127,29,29,0.16)]" />
      <div className="pointer-events-none absolute left-2 top-2 h-full w-full rounded-md border border-rose-300/18 bg-rose-300/[0.08]" />
      <div className="pointer-events-none absolute left-1 top-1 h-full w-full rounded-md border border-amber-300/16 bg-amber-300/[0.07]" />
      <button
        aria-label={`${item.overlapCount} overlapping appointments. ${frontAppointment.title} ${frontAppointment.customer}`}
        aria-pressed={active}
        draggable={!frontAppointment.readOnly}
        title={`${frontAppointment.title} | ${frontAppointment.start}-${frontAppointment.end} | ${frontAppointment.customer}${frontRequest ? ` | ${frontRequest.requestNumber}` : ""}`}
        className={`absolute cursor-pointer overflow-hidden rounded-md border px-2 py-1 text-left shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 ${
          active
            ? "border-cc-orange bg-cc-orange/24 text-cc-orange ring-2 ring-cc-orange"
            : `${frontPriorityClass} ring-1 ring-rose-200/70`
        }`}
        style={{
          height: item.cardHeight,
          left: Math.max(0, frontLeftWithinGroup),
          top: 0,
          width: Math.min(groupWidth, frontWidthWithinGroup),
        }}
        type="button"
        onBlur={(event) => {
          if (
            event.relatedTarget instanceof Node &&
            event.currentTarget.parentElement?.contains(event.relatedTarget)
          ) {
            return;
          }

          setOpen(false);
        }}
        onClick={() => onSelectAppointment(frontAppointment)}
        onDragEnd={onDragEnd}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", `appointment:${frontAppointment.id}`);
          onBeginAppointmentDrag(frontAppointment.id);
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="block truncate text-[12px] font-bold leading-4">
            {frontAppointment.title}
          </span>
          <span className="shrink-0 rounded-full border border-rose-100/40 bg-rose-100/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-50">
            <span className="flex items-center gap-1">
              <SentimentIcon sentiment={frontRequest?.sentiment} />
              +{item.overlapCount - 1}
            </span>
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1 font-mono text-[11px] font-semibold leading-4 text-white/90">
          <span>
            {frontAppointment.start}-{frontAppointment.end}
          </span>
          <span className="rounded-full bg-rose-300/20 px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-wide text-rose-50">
            Overlap
          </span>
        </div>
        <div className="truncate text-[10px] font-medium leading-3 opacity-90">
          {frontAppointment.customer}
          {frontRequest ? ` - ${frontRequest.requestNumber}` : ""}
        </div>
      </button>
      {open ? (
        <div
          className="absolute left-0 top-[66px] z-50 w-[300px] rounded-lg border border-rose-200/30 bg-cc-surface-2/98 p-2 shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
          data-testid="timeline-overlap-reveal"
        >
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-rose-100">
              {item.overlapCount} overlapping
            </span>
            <span className="rounded-full bg-rose-300/15 px-2 py-0.5 text-[10px] font-semibold text-rose-50">
              Conflict
            </span>
          </div>
          <div className="space-y-1.5">
            {item.appointments.map((appointment) => {
              const request = requests.find(
                (candidate) => candidate.id === appointment.requestId,
              );
              const selected = appointment.id === activeAppointmentId;
              return (
                <button
                  key={appointment.id}
                  aria-label={`${appointment.title} ${appointment.customer}`}
                  className={`w-full rounded-md border px-2 py-1.5 text-left text-xs transition hover:border-cc-orange/60 hover:bg-cc-orange/10 ${
                    selected
                      ? "border-cc-orange/70 bg-cc-orange/14"
                      : "border-white/10 bg-white/[0.035]"
                  }`}
                  draggable={!appointment.readOnly}
                  type="button"
                  onClick={() => onSelectAppointment(appointment)}
                  onDragEnd={onDragEnd}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", `appointment:${appointment.id}`);
                    onBeginAppointmentDrag(appointment.id);
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-2 font-semibold leading-snug text-slate-50">
                      {appointment.title}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-cc-orange">
                      <SentimentIcon sentiment={request?.sentiment} />
                      <span>{appointment.start}-{appointment.end}</span>
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-slate-300">
                    {appointment.customer}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-400">
                    <span className="truncate font-mono">
                      {request?.requestNumber ??
                        (appointment.source === "outlook" ? "Outlook event" : "Calendar")}
                    </span>
                    <span className="rounded-full bg-rose-300/12 px-1.5 py-0.5 font-semibold text-rose-100">
                      {appointment.syncIssue ? "Conflict" : appointment.status}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TimelineAppointment({
  active,
  appointment,
  cardHeight,
  hasUnreadUpdate,
  laneTop,
  onBeginDrag,
  onDragEnd,
  onSelect,
  request,
  searchState,
  trackWidth,
}: {
  active: boolean;
  appointment: Appointment;
  cardHeight: number;
  hasUnreadUpdate: boolean;
  laneTop: number;
  onBeginDrag: () => void;
  onDragEnd: () => void;
  onSelect: () => void;
  request?: DispatchRequest;
  searchState: SearchState;
  trackWidth: number;
}) {
  const warning = Boolean(appointment.syncIssue);
  const segments = getTimelineAppointmentSegments(appointment);
  const priorityClass = bookingCardPriorityClass(request?.priority);
  return (
    <>
      <TravelSideExtension
        active={active}
        edge="left"
        end={segments.to.end}
        label={segments.to.minutes > 0 ? `→ ${segments.to.minutes}m` : ""}
        minutes={segments.to.minutes}
        start={segments.to.start}
        height={cardHeight}
        top={laneTop}
        trackWidth={trackWidth}
      />
      <button
        aria-label={`${appointment.title} ${appointment.customer}`}
        aria-pressed={active}
        data-search-state={searchState}
        data-testid={`timeline-appointment-${appointment.id}`}
        draggable={!appointment.readOnly}
        title={`${appointment.title} | ${appointment.start}-${appointment.end} | ${appointment.customer}${request ? ` | ${request.requestNumber}` : ""}`}
        className={`absolute cursor-pointer overflow-hidden rounded-md border px-2 py-1 text-left shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 ${
          active
            ? "z-20 border-cc-orange bg-cc-orange/22 text-cc-orange ring-2 ring-cc-orange shadow-[0_0_0_1px_rgba(255,130,58,0.34),0_18px_42px_rgba(255,130,58,0.22)]"
            : `z-10 ${priorityClass} ${
                warning ? "ring-1 ring-amber-200/70" : ""
              }`
        } ${
          searchState === "dimmed" ? "opacity-35 grayscale" : ""
        } ${
          searchState === "match" ? "ring-1 ring-cc-orange/60" : ""
        }`}
        style={{
          height: cardHeight,
          left: timelineLeft(appointment.start, trackWidth),
          top: laneTop,
          width: timelineWidth(appointment.start, appointment.end, trackWidth),
        }}
        type="button"
        onDragEnd={onDragEnd}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", `appointment:${appointment.id}`);
          onBeginDrag();
        }}
        onClick={onSelect}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1 truncate text-[12px] font-bold leading-4">
            {appointment.activityType === "external_call" ? (
              <PhoneCall className="h-3 w-3 shrink-0" />
            ) : null}
            {appointment.title}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <SentimentIcon sentiment={request?.sentiment} />
            {hasUnreadUpdate ? (
              <TicketUpdateBadge
                compact
                dataTestId={`timeline-ticket-update-${appointment.id}`}
              />
            ) : null}
            {warning || appointment.travelWarning ? (
              <MailWarning className="h-3.5 w-3.5 shrink-0" />
            ) : null}
          </span>
        </div>
        <div className="mt-0.5 font-mono text-[11px] font-semibold leading-4 text-white/90">
          {appointment.start}-{appointment.end}
        </div>
        <div className="truncate text-[10px] font-medium leading-3 opacity-90">
          {appointment.customer}
          {request
            ? ` - ${request.requestNumber}`
            : appointment.activityType === "external_call"
              ? ` - ${formatTalkTime(appointment.externalTalkSeconds ?? 0)}`
              : ""}
        </div>
      </button>
      <TravelSideExtension
        active={active}
        edge="right"
        end={segments.back.end}
        label={segments.back.minutes > 0 ? `← ${segments.back.minutes}m` : ""}
        minutes={segments.back.minutes}
        start={segments.back.start}
        height={cardHeight}
        top={laneTop}
        trackWidth={trackWidth}
      />
    </>
  );
}

function TimelineDropPreview({
  preview,
  rowOffset,
  trackWidth,
}: {
  preview: DropPreview;
  rowOffset: number;
  trackWidth: number;
}) {
  const travelTo = preview.travelToSiteMinutes ?? 0;
  const travelBack = preview.travelBackToOfficeMinutes ?? 0;
  const blockedStart = timeFromMinutes(minutesFromTime(preview.start) - travelTo);
  const blockedEnd = timeFromMinutes(minutesFromTime(preview.end) + travelBack);
  const height = 48;
  const top = 14 + rowOffset;

  return (
    <>
      <TravelSideExtension
        active={false}
        edge="left"
        end={preview.start}
        height={height}
        label={travelTo > 0 ? `→ ${travelTo}m` : ""}
        minutes={travelTo}
        start={blockedStart}
        top={top}
        trackWidth={trackWidth}
        warning={preview.warning}
      />
      <div
        className={`pointer-events-none absolute z-0 overflow-hidden rounded-md border border-dashed px-2 py-1 text-xs ${
          preview.warning
            ? "border-amber-300/60 bg-amber-300/10 text-amber-50"
            : "border-cc-orange/60 bg-cc-orange/10 text-cc-orange"
        }`}
        style={{
          height,
          left: timelineLeft(preview.start, trackWidth),
          top,
          width: timelineWidth(preview.start, preview.end, trackWidth),
        }}
      >
        <div className="truncate font-semibold">Drop preview</div>
        <div className="font-mono leading-4">
          {preview.start}-{preview.end}
        </div>
      </div>
      <TravelSideExtension
        active={false}
        edge="right"
        end={blockedEnd}
        height={height}
        label={travelBack > 0 ? `← ${travelBack}m` : ""}
        minutes={travelBack}
        start={preview.end}
        top={top}
        trackWidth={trackWidth}
        warning={preview.warning}
      />
    </>
  );
}

function TravelSideExtension({
  active,
  edge,
  end,
  height,
  label,
  minutes,
  start,
  top,
  trackWidth,
  warning,
}: {
  active: boolean;
  edge: "left" | "right";
  end: string;
  height: number;
  label: string;
  minutes: number;
  start: string;
  top: number;
  trackWidth: number;
  warning?: boolean;
}) {
  if (minutes <= 0) {
    return null;
  }

  const widthPx = timelineWidth(start, end, trackWidth);
  const showLabel = widthPx >= 46;

  return (
    <div
      className={`pointer-events-none absolute z-[2] flex items-center overflow-hidden border px-1.5 text-[9px] font-semibold text-slate-300/80 ${
        edge === "left"
          ? "rounded-l-md rounded-r-none border-r-0 justify-end"
          : "rounded-l-none rounded-r-md border-l-0 justify-start"
      } ${
        active
          ? "border-cc-orange/40 bg-[repeating-linear-gradient(135deg,rgba(255,130,58,0.18)_0,rgba(255,130,58,0.18)_5px,rgba(255,130,58,0.07)_5px,rgba(255,130,58,0.07)_10px)] text-cc-orange/85"
          : warning
            ? "border-amber-300/25 bg-[repeating-linear-gradient(135deg,rgba(251,191,36,0.16)_0,rgba(251,191,36,0.16)_5px,rgba(251,191,36,0.06)_5px,rgba(251,191,36,0.06)_10px)] text-amber-100/80"
            : "border-slate-300/16 bg-[repeating-linear-gradient(135deg,rgba(148,163,184,0.16)_0,rgba(148,163,184,0.16)_5px,rgba(148,163,184,0.06)_5px,rgba(148,163,184,0.06)_10px)]"
      }`}
      style={{
        height,
        left: timelineLeft(start, trackWidth),
        top,
        width: widthPx,
      }}
    >
      {showLabel ? <span className="truncate">{label}</span> : null}
    </div>
  );
}

function DetailDrawer({
  appointment,
  calendarWriteEnabled,
  onOpenWorkLog,
  onSyncCalendar,
  request,
  selectionKind,
  technician,
}: {
  appointment?: Appointment;
  calendarWriteEnabled: boolean;
  onOpenWorkLog: (requestId: string) => void;
  onSyncCalendar: () => void;
  request?: DispatchRequest;
  selectionKind: Selection["kind"];
  technician: string;
}) {
  const isOutlookOnly = appointment?.source === "outlook" && !request;
  const title = isOutlookOnly
    ? appointment.title
    : request?.subject ?? appointment?.title ?? "No selection";
  const eyebrow = isOutlookOnly
    ? "Outlook"
    : request?.requestNumber ?? appointment?.outlookLinkedRequestNumber ?? "Calendar";
  const helpdeskUrl = request?.helpdeskUrl;

  return (
    <aside
      className="min-h-0 overflow-auto rounded-lg border border-cc-orange/20 bg-cc-surface-1 shadow-[0_0_0_1px_rgba(255,130,58,0.08),0_20px_44px_rgba(0,0,0,0.28)]"
      data-testid="command-centre-drawer"
    >
      <div className="border-b border-cc-orange/10 bg-cc-orange/[0.03] p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          {isOutlookOnly ? "Calendar Event" : "Request"}
        </p>
        <div className="mt-1.5 flex items-start justify-between gap-2">
          <div>
            <div className="font-mono text-xs text-cc-orange">
              {eyebrow}
            </div>
            <h2 className="mt-0.5 text-base font-semibold leading-snug text-slate-50">
              {title}
            </h2>
          </div>
          {request ? <PriorityChip priority={request.priority} /> : null}
        </div>
        <div className="mt-2 h-1 rounded-full bg-cc-orange/20">
          <div
            className={`h-full rounded-full bg-cc-orange ${
              selectionKind === "appointment" ? "w-full" : "w-2/3"
            }`}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {(request?.warnings ?? outlookWarnings(appointment)).map((warning) => (
            <Badge key={warning} tone="warning">
              {warning}
            </Badge>
          ))}
        </div>
        {request?.updateInfo ? (
          <div className="mt-2 rounded-md border border-cc-orange/25 bg-cc-orange/10 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-cc-orange">
                Ticket update
              </span>
              <span className="text-[10px] font-semibold text-slate-300">
                {formatTicketUpdateSource(request.updateInfo.source)}{" - "}
                {formatDateTime(request.updateInfo.at)}
              </span>
            </div>
            <div className="mt-1 text-xs font-semibold text-slate-50">
              {request.updateInfo.summary}
            </div>
            {request.updateInfo.detail ? (
              <div className="mt-0.5 text-xs leading-snug text-slate-300">
                {request.updateInfo.detail}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="space-y-2.5 p-3">
        <DrawerSection title="Helpdesk">
          {request ? (
            <>
              <DetailRow label="Customer/site" value={`${request.customer} / ${request.site}`} />
              <DetailRow label="Contact" value={`${request.requester} / ${request.contact}`} />
              <DetailRow label="Source" value={requestSourceLabel(request)} />
              <DetailRow label="Status" value={request.status} />
              <DetailRow label="Due time" value={formatDateTime(request.dueAt)} />
              {request.sentiment ? (
                <DetailRow
                  label="Sentiment"
                  value={sentimentLabel(request.sentiment)}
                />
              ) : null}
              <DetailRow
                label="Notes"
                value={requestNotesSummary(request)}
              />
            </>
          ) : (
            <>
              <DetailRow label="Link" value="No Helpdesk request linked" />
              <DetailRow label="Source" value="Outlook calendar read-only" />
              <DetailRow label="Owner" value={appointment?.calendarOwnerEmail ?? "Unknown"} />
            </>
          )}
        </DrawerSection>
        <DrawerSection title="Schedule and sync">
          <DetailRow label="Technician" value={technician} />
          <DetailRow
            label="Technician mapping"
            value={request?.technicianId ? "Mapped" : "Review required"}
          />
          <DetailRow
            label="Scheduled"
            value={
              appointment
                ? `${appointment.start}-${appointment.end}`
                : request?.scheduledStart
                  ? `${formatTime(request.scheduledStart)}-${formatTime(request.scheduledEnd ?? request.scheduledStart)}`
                  : "Not scheduled"
            }
          />
          <DetailRow
            label="Outlook"
            value={appointment ? appointment.title : "No linked event yet"}
          />
          <DetailRow
            label="Calendar link"
            value={appointment ? "Linked/read-only" : "No linked event yet"}
          />
          {appointment?.outlookShowAs ? (
            <DetailRow label="Free/busy" value={appointment.outlookShowAs} />
          ) : null}
          <DetailRow
            label="Sync"
            value={
              appointment?.outlookIssue ??
              appointment?.syncIssue ??
              (appointment?.readOnly ? "Read only" : "Review required")
            }
          />
        </DrawerSection>
        <DrawerSection title="Travel">
          {appointment && request ? (
            <TravelDrawerDetails appointment={appointment} request={request} />
          ) : appointment?.source === "outlook" ? (
            <>
              <DetailRow label="Travel" value="Not calculated for read-only Outlook events" />
              <DetailRow label="Blocked" value={`${appointment.start}-${appointment.end}`} />
            </>
          ) : (
            <>
              <DetailRow
                label="Office"
                value="Set when scheduled"
              />
              <DetailRow
                label="To"
                value={request?.siteAddress || request?.site || "Unknown site"}
              />
            </>
          )}
        </DrawerSection>
        <DrawerSection title="Actions">
          <div className="grid gap-2">
            <ActionButton
              disabled={!request}
              icon={<Clock3 className="h-4 w-4" />}
              onClick={() => request && onOpenWorkLog(request.id)}
              primary={Boolean(request)}
              title={
                request
                  ? "Record a local/test-sync Work Log for this request-backed ticket."
                  : "Work Log requires a linked helpdesk request."
              }
            >
              Work Log
            </ActionButton>
            <ActionButton
              disabled={!helpdeskUrl}
              href={helpdeskUrl}
              icon={<ExternalLink className="h-4 w-4" />}
              primary={Boolean(helpdeskUrl)}
              title={
                helpdeskUrl
                  ? "Open request in MSP Central Helpdesk"
                  : "MSP Central request URL is not configured yet."
              }
            >
              Open in Helpdesk
            </ActionButton>
            <ActionButton
              href={appointment?.outlookWebLink}
              icon={<CalendarDays className="h-4 w-4" />}
              title={
                appointment?.outlookWebLink
                  ? "Open read-only Outlook event"
                  : "No Outlook event link available"
              }
            >
              Open Outlook Event
            </ActionButton>
            <ActionButton
              disabled
              icon={<Clock3 className="h-4 w-4" />}
              title="MSP Central API access is not configured yet."
            >
              Reschedule
            </ActionButton>
            <ActionButton
              disabled={!request || !appointment || !calendarWriteEnabled}
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={onSyncCalendar}
              title={
                request && appointment && calendarWriteEnabled
                  ? "Create or update the linked Outlook event and MSP Central schedule."
                  : "Select a linked scheduled request while Outlook writeback is enabled."
              }
            >
              Create / Update Calendar Event
            </ActionButton>
          </div>
        </DrawerSection>
      </div>
    </aside>
  );
}

function DrawerSection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-md border border-white/10 bg-white/[0.03] p-2.5">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
        {title}
      </h3>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function TravelDrawerDetails({
  appointment,
  request,
}: {
  appointment: Appointment;
  request: DispatchRequest;
}) {
  const blockedWindow = getAppointmentBlockedWindow(appointment);
  const toSite = appointment.travelToSiteMinutes ?? 0;
  const back = appointment.travelBackToOfficeMinutes ?? 0;

  return (
    <>
      <DetailRow
        label="Office"
        value={appointment.officeOriginName ?? "No travel origin"}
      />
      <DetailRow
        label="From"
        value={appointment.officeOriginAddress ?? "Not set"}
      />
      <DetailRow
        label="To"
        value={appointment.siteAddress || request.siteAddress || request.site}
      />
      <DetailRow label="To site" value={`${toSite} minutes`} />
      <DetailRow label="Back" value={`${back} minutes`} />
      <DetailRow
        label="Job time"
        value={`${appointment.start}-${appointment.end}`}
      />
      <DetailRow
        label="Blocked"
        value={`${blockedWindow.blockedStart}-${blockedWindow.blockedEnd}`}
      />
      <DetailRow
        label="Estimate"
        value={
          appointment.travelWarning ??
          appointment.travelCalculationReason ??
            "Estimated from technician base office"
        }
      />
    </>
  );
}

function DetailInline({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[84px_1fr] gap-2">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-slate-100">{value}</span>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[86px_1fr] gap-2 text-xs">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-slate-100">{value}</span>
    </div>
  );
}

function ActionButton({
  children,
  disabled = false,
  href,
  icon,
  onClick,
  primary = false,
  title,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  href?: string;
  icon: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
  title?: string;
}) {
  const className = `flex items-center justify-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-semibold ${
    disabled
      ? "cursor-not-allowed border border-white/10 bg-white/[0.03] text-slate-500"
      : primary
      ? "bg-cc-orange text-cc-surface-1"
      : "border border-white/10 bg-white/5 text-slate-200"
  }`;

  if (href && !disabled) {
    return (
      <a
        className={className}
        href={href}
        rel="noreferrer"
        target="_blank"
        title={title}
      >
        {icon}
        {children}
      </a>
    );
  }

  return (
    <button
      className={className}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {icon}
      {children}
    </button>
  );
}

function requestSourceLabel(request: DispatchRequest) {
  if (request.sourceSystem === "command-centre-db") {
    return "Command Centre DB";
  }

  if (request.sourceSystem === "msp-central") {
    return "MSP Central";
  }

  if (request.sourceSystem === "msp-central-fixture") {
    return "MSP Fixture";
  }

  return "Mock";
}

export function requestNotesSummary(request: DispatchRequest) {
  if (request.notes?.trim()) {
    return request.notes;
  }

  return request.sourceSystem === "msp-central" ||
    request.sourceSystem === "msp-central-fixture"
    ? "No notes provided."
    : "Mock note. Confirm access and parts before dispatch.";
}

function hasUnreadTicketUpdate(
  request: DispatchRequest | undefined,
  seenTicketUpdateIds: SeenTicketUpdateIds,
) {
  return Boolean(
    request?.updateInfo && !seenTicketUpdateIds.has(request.id),
  );
}

function formatTicketUpdateSource(
  source: NonNullable<DispatchRequest["updateInfo"]>["source"],
) {
  if (source === "msp-central") {
    return "MSP Central";
  }

  if (source === "technician-app") {
    return "Technician app";
  }

  if (source === "test-sync") {
    return "Test sync";
  }

  return "Command Centre";
}

function workTypeLabel(value: string) {
  if (value === "non_billable") {
    return "non-billable";
  }

  if (value === "internal") {
    return "internal";
  }

  return "billable";
}

function outlookWarnings(appointment?: Appointment) {
  if (!appointment) {
    return ["No selection"];
  }

  if (appointment.outlookIssue === "unlinked") {
    return ["Unlinked Outlook event"];
  }

  if (appointment.outlookIssue === "private") {
    return ["Private appointment"];
  }

  if (appointment.outlookIssue === "all-day") {
    return ["All-day block"];
  }

  if (appointment.outlookIssue === "closed-day") {
    return ["Closed-day booking"];
  }

  return appointment.readOnly ? ["Outlook read-only"] : ["Review required"];
}

function PriorityChip({ priority }: { priority: DispatchRequest["priority"] }) {
  const classes = {
    Critical: "bg-rose-400/15 text-rose-100 border-rose-300/30",
    High: "bg-amber-300/15 text-amber-100 border-amber-300/30",
    Medium: "bg-sky-300/15 text-sky-100 border-sky-300/30",
    Low: "bg-slate-300/10 text-slate-200 border-slate-300/20",
  };

  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${classes[priority]}`}
    >
      {priority}
    </span>
  );
}

function SentimentIcon({
  sentiment,
}: {
  sentiment?: DispatchRequest["sentiment"];
}) {
  if (!sentiment) {
    return null;
  }

  const config = {
    negative: {
      className: "text-rose-200",
      Icon: Frown,
      label: "Negative sentiment",
    },
    neutral: {
      className: "text-slate-200",
      Icon: Meh,
      label: "Neutral sentiment",
    },
    positive: {
      className: "text-emerald-200",
      Icon: Smile,
      label: "Positive sentiment",
    },
  }[sentiment];

  return (
    <config.Icon
      aria-label={config.label}
      className={`h-3.5 w-3.5 shrink-0 ${config.className}`}
    />
  );
}

function sentimentLabel(sentiment: NonNullable<DispatchRequest["sentiment"]>) {
  return `${sentiment[0].toUpperCase()}${sentiment.slice(1)}`;
}

function TicketUpdateBadge({
  compact = false,
  dataTestId,
}: {
  compact?: boolean;
  dataTestId?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-cc-orange/45 bg-cc-orange/20 font-bold uppercase tracking-wide text-cc-orange shadow-[0_0_12px_rgba(255,130,58,0.18)] ${
        compact ? "px-1.5 py-0.5 text-[8px]" : "px-2 py-0.5 text-[10px]"
      }`}
      data-testid={dataTestId}
    >
      Updated
    </span>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "critical" | "info" | "muted" | "warning";
}) {
  const classes = {
    critical: "bg-rose-400/15 text-rose-100",
    info: "bg-sky-300/15 text-sky-100",
    muted: "bg-slate-300/10 text-slate-300",
    warning: "bg-amber-300/15 text-amber-100",
  };

  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${classes[tone]}`}>
      {children}
    </span>
  );
}

function IconButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="rounded-md border border-white/10 bg-white/5 p-1.5 text-slate-200"
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function severityClass(severity: Severity) {
  return {
    critical: "border-rose-300/25 bg-rose-400/12 text-rose-50",
    warning: "border-amber-300/25 bg-amber-300/12 text-amber-50",
    info: "border-cc-orange/20 bg-cc-orange/10 text-cc-orange",
    healthy: "border-emerald-300/20 bg-emerald-300/10 text-emerald-50",
  }[severity];
}

function appointmentSearchState(
  appointment: Appointment,
  search: string,
  activeHealth: string | undefined,
  requests: DispatchRequest[],
  technicians: Technician[],
): SearchState {
  const hasSearch = Boolean(search.trim());
  const hasHealth = Boolean(activeHealth);

  if (!hasSearch && !hasHealth) {
    return "normal";
  }

  const request = requests.find((candidate) => candidate.id === appointment.requestId);
  const matchesSearch = !hasSearch ||
    appointmentMatchesSearch(appointment, search, request, technicians);
  const matchesHealth = !activeHealth ||
    appointmentMatchesHealthFilter(appointment, activeHealth, request);

  return matchesSearch && matchesHealth ? "match" : "dimmed";
}

function appointmentMatchesSearch(
  appointment: Appointment,
  search: string,
  request: DispatchRequest | undefined,
  technicians: Technician[],
) {
  return includesQuery(
    [
      appointment.title,
      appointment.customer,
      appointment.status,
      appointment.source,
      appointment.syncIssue,
      appointment.outlookIssue,
      appointment.outlookOrganizer,
      appointment.outlookShowAs,
      appointment.outlookLinkedRequestNumber,
      appointment.siteAddress,
      appointment.siteTown,
      appointment.siteArea,
      appointment.officeOriginName,
      appointment.bodyPreview,
      technicianLabel(technicians, appointment.technicianId),
      request ? requestSearchFields(request, technicians) : undefined,
    ],
    search,
  );
}

function requestMatchesSearch(
  request: DispatchRequest,
  search: string,
  technicians: Technician[],
) {
  return includesQuery(requestSearchFields(request, technicians), search);
}

function requestSearchFields(
  request: DispatchRequest,
  technicians: Technician[],
) {
  return [
    request.requestNumber,
    request.subject,
    request.customer,
    request.site,
    request.siteName,
    request.siteAddress,
    request.siteTown,
    request.siteArea,
    request.requester,
    request.contact,
    request.status,
    request.priority,
    request.slaState,
    request.notes,
    request.category,
    request.subcategory,
    request.item,
    request.assetNames,
    request.updateInfo?.summary,
    request.updateInfo?.detail,
    request.updateInfo?.source,
    request.readyToBook ? "Ready to book" : undefined,
    technicianLabel(technicians, request.technicianId),
    ...request.warnings,
  ];
}

function hasDisplayableSite(site?: string) {
  const normalized = site?.trim().toLowerCase();
  return Boolean(
    normalized &&
      normalized !== "unknown site" &&
      normalized !== "site not provided",
  );
}

function includesQuery(values: unknown, search: string) {
  const query = search.trim().toLowerCase();

  if (!query) {
    return true;
  }

  return flattenSearchValues(values).some((value) =>
    value.toLowerCase().includes(query),
  );
}

function flattenSearchValues(values: unknown): string[] {
  if (Array.isArray(values)) {
    return values.flatMap(flattenSearchValues);
  }

  if (values === null || values === undefined) {
    return [];
  }

  return [String(values)];
}

function requestMatchesQueueFilters(
  request: DispatchRequest,
  filters: QueueFilters,
) {
  if (filters.technician === "unassigned" && request.technicianId) {
    return false;
  }

  if (
    filters.technician &&
    filters.technician !== "unassigned" &&
    request.technicianId !== filters.technician
  ) {
    return false;
  }

  if (filters.priority && request.priority !== filters.priority) {
    return false;
  }

  if (filters.status && !requestMatchesStatusFilter(request, filters.status)) {
    return false;
  }

  if (filters.sla && !requestMatchesSlaFilter(request, filters.sla)) {
    return false;
  }

  return true;
}

function requestMatchesStatusFilter(request: DispatchRequest, filter: string) {
  const warnings = request.warnings.map((warning) => warning.toLowerCase());

  if (filter === "ready") {
    return request.readyToBook;
  }

  if (filter === "needs-review") {
    return warnings.some((warning) => warning.includes("needs review"));
  }

  if (filter === "waiting-customer") {
    return request.status.toLowerCase().includes("waiting customer") ||
      warnings.some((warning) => warning.includes("waiting customer"));
  }

  if (filter === "waiting-parts") {
    return request.status.toLowerCase().includes("waiting parts") ||
      warnings.some((warning) => warning.includes("parts"));
  }

  if (filter === "scheduled") {
    return Boolean(request.scheduledStart) || request.status === "Scheduled";
  }

  return request.status.toLowerCase() === filter;
}

function requestMatchesSlaFilter(request: DispatchRequest, filter: string) {
  if (filter === "risk") {
    return request.slaState !== "normal";
  }

  if (filter === "normal") {
    return request.slaState === "normal";
  }

  if (filter === "overdue") {
    return request.slaState === "overdue";
  }

  return true;
}

function requestMatchesHealthFilter(
  request: DispatchRequest,
  activeHealth?: string,
  appointments: Appointment[] = [],
) {
  if (!activeHealth) {
    return true;
  }

  if (activeHealth === "unscheduled") {
    return !request.scheduledStart;
  }

  const linkedAppointments = appointments.filter(
    (appointment) => appointment.requestId === request.id,
  );
  const requestWarnings = request.warnings.join(" ").toLowerCase();

  if (activeHealth === "sla-risk") {
    return request.slaState !== "normal";
  }

  if (activeHealth === "double-booked") {
    return linkedAppointments.some((appointment) =>
      appointmentMatchesHealthFilter(appointment, activeHealth, request),
    ) || requestWarnings.includes("double-booked");
  }

  if (activeHealth === "missing-calendar") {
    return linkedAppointments.some((appointment) =>
      appointmentMatchesHealthFilter(appointment, activeHealth, request),
    ) || /missing calendar/.test(requestWarnings);
  }

  if (activeHealth === "time-mismatch") {
    return linkedAppointments.some((appointment) =>
      appointmentMatchesHealthFilter(appointment, activeHealth, request),
    ) || /sync|calendar|double-booked|mapping|review/.test(requestWarnings);
  }

  if (activeHealth === "past-open") {
    return linkedAppointments.some((appointment) =>
      appointmentMatchesHealthFilter(appointment, activeHealth, request),
    ) || /past scheduled open/.test(requestWarnings);
  }

  if (activeHealth === "mapping") {
    return !request.technicianId || /missing technician mapping/.test(requestWarnings);
  }

  if (activeHealth === "travel-conflicts") {
    return linkedAppointments.some((appointment) =>
      appointmentMatchesHealthFilter(appointment, activeHealth, request),
    ) || /travel|onsite|site/.test(requestWarnings);
  }

  if (activeHealth === "out-of-hours") {
    return linkedAppointments.some((appointment) =>
      appointmentMatchesHealthFilter(appointment, activeHealth, request),
    ) || /out.?of.?hours|closed.?day|weekend/.test(requestWarnings);
  }

  if (activeHealth === "unlinked-outlook") {
    return linkedAppointments.some((appointment) =>
      appointmentMatchesHealthFilter(appointment, activeHealth, request),
    );
  }

  if (activeHealth === "closed-day") {
    return linkedAppointments.some((appointment) =>
      appointmentMatchesHealthFilter(appointment, activeHealth, request),
    ) || /closed.?day|weekend/.test(requestWarnings);
  }

  if (activeHealth === "all-day-events") {
    return linkedAppointments.some((appointment) =>
      appointmentMatchesHealthFilter(appointment, activeHealth, request),
    );
  }

  return false;
}

function appointmentMatchesHealthFilter(
  appointment: Appointment,
  activeHealth: string,
  request?: DispatchRequest,
) {
  const requestWarnings = request?.warnings.join(" ").toLowerCase() ?? "";

  if (activeHealth === "unscheduled") {
    return false;
  }

  if (activeHealth === "sla-risk") {
    return request?.slaState !== undefined && request.slaState !== "normal";
  }

  if (activeHealth === "double-booked") {
    return appointment.syncIssue === "double-booked" ||
      requestWarnings.includes("double-booked");
  }

  if (activeHealth === "missing-calendar") {
    return appointment.syncIssue === "missing-calendar" ||
      /missing calendar/.test(requestWarnings);
  }

  if (activeHealth === "time-mismatch") {
    return Boolean(
      appointment.syncIssue === "missing-calendar" ||
        appointment.syncIssue === "time-mismatch" ||
        appointment.syncIssue === "double-booked" ||
        appointment.outlookIssue === "private" ||
        appointment.outlookIssue === "unlinked",
    );
  }

  if (activeHealth === "past-open") {
    return appointment.syncIssue === "past-open" ||
      /past scheduled open/.test(requestWarnings);
  }

  if (activeHealth === "travel-conflicts") {
    return hasTravelHealthIssue(appointment);
  }

  if (activeHealth === "out-of-hours") {
    return appointmentIsOutOfHours(appointment);
  }

  if (activeHealth === "unlinked-outlook") {
    return appointment.outlookIssue === "unlinked";
  }

  if (activeHealth === "closed-day") {
    return appointment.outlookIssue === "closed-day";
  }

  if (activeHealth === "all-day-events") {
    return appointment.outlookIssue === "all-day" || Boolean(appointment.isAllDay);
  }

  if (activeHealth === "mapping") {
    return Boolean(request && !request.technicianId) ||
      /missing technician mapping/.test(requestWarnings);
  }

  return false;
}

function appointmentIsOutOfHours(appointment: Appointment) {
  if (appointment.outlookIssue === "closed-day" || appointmentIsClosedDay(appointment)) {
    return true;
  }

  return minutesFromTime(appointment.start) < 9 * 60 ||
    minutesFromTime(appointment.end) > 17 * 60;
}

function appointmentIsClosedDay(appointment: Appointment) {
  const date = appointment.date;

  if (!date) {
    return false;
  }

  const weekday = new Date(`${date}T12:00:00+10:00`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function hasTravelHealthIssue(appointment: Appointment) {
  return Boolean(
    appointment.travelWarning ||
      appointment.travelEstimated ||
      appointment.travelToSiteMinutes ||
      appointment.travelBackToOfficeMinutes,
  );
}

function technicianFilterOptions(technicians: Technician[]) {
  return [
    { label: "All technicians" },
    { label: "Unassigned", value: "unassigned" },
    ...technicians.map((technician) => ({
      label: technician.displayName,
      value: technician.id,
    })),
  ];
}

function statusFilterOptions() {
  return [
    { label: "All statuses" },
    { label: "Open", value: "open" },
    { label: "Ready to book", value: "ready" },
    { label: "Waiting customer", value: "waiting-customer" },
    { label: "Waiting parts", value: "waiting-parts" },
    { label: "Needs review", value: "needs-review" },
    { label: "Scheduled", value: "scheduled" },
  ];
}

function priorityFilterOptions() {
  return [
    { label: "All priorities" },
    { label: "Low", value: "Low" },
    { label: "Medium", value: "Medium" },
    { label: "High", value: "High" },
    { label: "Critical", value: "Critical" },
  ];
}

function slaFilterOptions() {
  return [
    { label: "All SLA" },
    { label: "SLA risk", value: "risk" },
    { label: "No SLA risk", value: "normal" },
    { label: "Overdue", value: "overdue" },
  ];
}

function buildActiveFilterSummary({
  activeHealthItem,
  queueFilters,
  queueSearch,
  topSearch,
}: {
  activeHealthItem?: HealthItem;
  queueFilters: QueueFilters;
  queueSearch: string;
  topSearch: string;
}) {
  const parts = [
    topSearch.trim() ? `Command Centre "${topSearch.trim()}"` : undefined,
    queueSearch.trim() ? `Requests "${queueSearch.trim()}"` : undefined,
    queueFilters.technician
      ? `Technician ${queueFilters.technician === "unassigned" ? "Unassigned" : queueFilters.technician}`
      : undefined,
    queueFilters.status ? statusFilterLabel(queueFilters.status) : undefined,
    queueFilters.priority ? `${queueFilters.priority} priority` : undefined,
    queueFilters.sla ? slaFilterLabel(queueFilters.sla) : undefined,
    activeHealthItem ? healthLabel(activeHealthItem) : undefined,
  ].filter(Boolean);

  return parts.join(" · ");
}

function statusFilterLabel(value: string) {
  return statusFilterOptions().find((option) => option.value === value)?.label;
}

function slaFilterLabel(value: string) {
  return slaFilterOptions().find((option) => option.value === value)?.label;
}

function healthLabel(item: HealthItem) {
  return HEALTH_SHORT_LABELS[item.key] ?? item.label;
}

function healthCardClass(item: HealthItem, active: boolean) {
  const quietZero = item.count === 0 && !active;

  return [
    "min-h-[62px] cursor-pointer rounded-md border px-2.5 py-1.5 text-left transition",
    "hover:-translate-y-0.5 hover:border-white/30 hover:shadow-lg",
    "active:translate-y-0 active:scale-[0.99]",
    quietZero
      ? "border-white/10 bg-white/[0.025] text-slate-400 hover:bg-white/[0.045]"
      : severityClass(item.severity),
    active
      ? "ring-2 ring-cc-orange shadow-[0_0_28px_rgba(255,130,58,0.16)]"
      : "",
  ].join(" ");
}

function technicianLabel(technicians: Technician[], technicianId?: string) {
  return (
    technicians.find((technician) => technician.id === technicianId)
      ?.displayName ?? "Unassigned"
  );
}

function formatDuration(minutes: number) {
  if (minutes < 60) {
    return `${minutes} minutes`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  return remainder
    ? `${hours}h ${remainder}m`
    : `${hours} hour${hours === 1 ? "" : "s"}`;
}

function scheduleTimeOptions() {
  const options: string[] = [];
  for (let minutes = 9 * 60; minutes <= 17 * 60; minutes += 15) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    options.push(
      `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`,
    );
  }
  return options;
}

function timelineMarkers() {
  return buildTimelineMarkers();
}

function scaleTimelineX(valuePx: number, trackWidth = TIMELINE_TRACK_WIDTH_PX) {
  return (valuePx / TIMELINE_TRACK_WIDTH_PX) * trackWidth;
}

function timelineLeft(time: string, trackWidth = TIMELINE_TRACK_WIDTH_PX) {
  return scaleTimelineX(
    getTimelineItemPosition({ itemEnd: time, itemStart: time }).leftPx,
    trackWidth,
  );
}

function timelineWidth(
  start: string,
  end: string,
  trackWidth = TIMELINE_TRACK_WIDTH_PX,
) {
  return scaleTimelineX(
    getTimelineItemPosition({ itemEnd: end, itemStart: start }).widthPx,
    trackWidth,
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Australia/Melbourne",
  }).format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Melbourne",
  }).format(date);
}

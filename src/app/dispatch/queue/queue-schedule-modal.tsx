"use client";

import { useState } from "react";

import {
  publishDispatchTestSyncEvent,
  publishLiveSchedule,
  ScheduleConfirmModal,
  type PendingSchedule,
} from "@/app/dispatch/command-centre/prototype";
import {
  applyBookingTypeToRequest,
  bookingTiming,
  bookingTypeForRequest,
} from "@/server/dispatch/booking";
import {
  selectedDateIsPast,
  todayDateKey,
} from "@/server/dispatch/date-scope";
import {
  buildScheduleSlot,
  detectScheduleWarnings,
  minutesFromTime,
} from "@/server/dispatch/scheduling";
import {
  applyTravelToAppointment,
  buildAppointmentTravel,
  type TravelEstimate,
} from "@/server/dispatch/travel";
import type {
  Appointment,
  BookingType,
  DispatchDashboardData,
  DispatchRequest,
  Technician,
} from "@/server/dispatch/types";

export function QueueScheduleModal({
  appointment,
  dashboard,
  onCancel,
  onScheduled,
  request,
}: {
  appointment?: Appointment;
  dashboard: DispatchDashboardData;
  onCancel: () => void;
  onScheduled: (message: string) => void;
  request: DispatchRequest;
}) {
  const [pending, setPending] = useState<PendingSchedule | undefined>(() =>
    createInitialPending({ appointment, dashboard, request }),
  );
  const [error, setError] = useState<string>();

  if (!pending) {
    return null;
  }

  const updatePending = (
    changes: Partial<
      Pick<
        PendingSchedule,
        | "bookingType"
        | "crewTechnicianIds"
        | "date"
        | "durationMinutes"
        | "start"
        | "technicianId"
      >
    >,
  ) => {
    setError(undefined);
    setPending((current) =>
      current
        ? recalculatePending({
            dashboard,
            pending: { ...current, ...changes },
            request,
          })
        : current,
    );
  };

  async function confirm() {
    if (!pending) return;
    setError(undefined);

    try {
      const liveSchedule = canUseLiveSchedule(dashboard, request);
      const teamAppointments = requestScheduleAppointments(
        dashboard.appointments,
        request.id,
        appointment,
      );
      const bookingType = pending.bookingType;
      const previousAssignments = teamAppointments
        .filter((candidate) => candidate.outlookEventId)
        .map((candidate) => ({
          eventId: candidate.outlookEventId as string,
          technicianId: candidate.technicianId,
          userPrincipalName:
            candidate.calendarOwnerEmail ??
            technicianOutlookIdentity(
              dashboard.technicians,
              candidate.technicianId,
            ),
        }));
      const crew = (pending.crewTechnicianIds ?? []).map((technicianId) => ({
        eventId: teamAppointments.find(
          (candidate) => candidate.technicianId === technicianId,
        )?.outlookEventId,
        technicianEmail: technicianMspCentralIdentity(
          dashboard.technicians,
          technicianId,
        ),
        technicianId,
        technicianName: technicianLabel(dashboard.technicians, technicianId),
        travel: buildTravel(dashboard, request, technicianId, bookingType),
        userPrincipalName: technicianOutlookIdentity(
          dashboard.technicians,
          technicianId,
        ),
      }));
      const idempotencyKey =
        pending.idempotencyKey ?? createClientCommandId("schedule");
      const appointmentId =
        pending.kind === "appointment"
          ? pending.scheduleGroupId
          : teamAppointments.find((candidate) => candidate.scheduleGroupId)
              ?.scheduleGroupId ??
            `pending-live-${request.id}-${idempotencyKey}`;
      const leadAppointment = teamAppointments.find(
        (candidate) => candidate.technicianId === pending.technicianId,
      );

      if (liveSchedule) {
        const result = await publishLiveSchedule({
          appointmentId,
          bookingType,
          crew,
          customer: request.customer,
          date: pending.date,
          end: pending.end,
          eventId: leadAppointment?.outlookEventId,
          idempotencyKey,
          location: request.siteAddress ?? request.site,
          previousAssignments,
          priority: request.priority,
          requestId: request.id,
          requestNumber: request.requestNumber,
          scheduleAction:
            pending.kind === "appointment" || teamAppointments.length > 0
              ? "rescheduled"
              : "scheduled",
          start: pending.start,
          subject: request.subject,
          technicianEmail: technicianMspCentralIdentity(
            dashboard.technicians,
            pending.technicianId,
          ),
          technicianId: pending.technicianId,
          technicianMspCentralId: technicianMspCentralId(
            dashboard.technicians,
            pending.technicianId,
          ),
          technicianName: technicianLabel(
            dashboard.technicians,
            pending.technicianId,
          ),
          travel: pending.travel,
          userPrincipalName: technicianOutlookIdentity(
            dashboard.technicians,
            pending.technicianId,
          ),
        });
        onScheduled(scheduleReceiptMessage(request.requestNumber, result.status));
        return;
      }

      await Promise.all(
        [pending.technicianId, ...crew.map((member) => member.technicianId)].map(
          (technicianId, index) =>
            publishDispatchTestSyncEvent({
              appointmentId:
                index === 0
                  ? appointmentId
                  : `${appointmentId}-crew-${technicianId}`,
              bookingType,
              date: pending.date,
              end: pending.end,
              eventType:
                pending.kind === "appointment" ? "rescheduled" : "scheduled",
              payload: {
                travel: buildTravel(
                  dashboard,
                  request,
                  technicianId,
                  bookingType,
                ),
              },
              priority: request.priority,
              requestId: request.id,
              start: pending.start,
              technicianId,
            }),
        ),
      );
      onScheduled(
        `${request.requestNumber} ${
          pending.kind === "appointment" ? "rescheduled" : "scheduled"
        } in test mode.`,
      );
    } catch (scheduleError) {
      setError(
        scheduleError instanceof Error
          ? `Schedule did not save: ${scheduleError.message}`
          : "Schedule did not save.",
      );
    }
  }

  return (
    <ScheduleConfirmModal
      error={error}
      liveSchedule={canUseLiveSchedule(dashboard, request)}
      pending={pending}
      request={request}
      technicians={dashboard.technicians}
      onBookingTypeChange={(bookingType) => updatePending({ bookingType })}
      onCancel={onCancel}
      onConfirm={confirm}
      onCrewChange={(technicianId, selected) =>
        updatePending({
          crewTechnicianIds: selected
            ? [...(pending.crewTechnicianIds ?? []), technicianId]
            : (pending.crewTechnicianIds ?? []).filter(
                (candidate) => candidate !== technicianId,
              ),
        })
      }
      onDateChange={(date) => updatePending({ date })}
      onDurationChange={(durationMinutes) => updatePending({ durationMinutes })}
      onStartChange={(start) => updatePending({ start })}
      onTechnicianChange={(technicianId) =>
        updatePending({
          crewTechnicianIds: (pending.crewTechnicianIds ?? []).filter(
            (candidate) => candidate !== technicianId,
          ),
          technicianId,
        })
      }
    />
  );
}

function createInitialPending({
  appointment,
  dashboard,
  request,
}: {
  appointment?: Appointment;
  dashboard: DispatchDashboardData;
  request: DispatchRequest;
}): PendingSchedule | undefined {
  const technicianId =
    appointment?.technicianId ??
    request.technicianId ??
    dashboard.technicians.find((technician) => technician.active)?.id;
  if (!technicianId) return undefined;

  const bookingType =
    appointment?.bookingType ?? bookingTypeForRequest(request);
  const totalDurationMinutes = appointment
    ? minutesFromTime(appointment.end) - minutesFromTime(appointment.start)
    : 60;
  const durationMinutes =
    appointment?.workDurationMinutes ??
    Math.max(
      15,
      totalDurationMinutes - (bookingType === "Onsite" ? 15 : 0),
    );
  const date =
    appointment?.date ?? request.scheduledStart?.slice(0, 10) ?? todayDateKey();
  const start = appointment?.start ?? "09:00";
  const teamAppointments = requestScheduleAppointments(
    dashboard.appointments,
    request.id,
    appointment,
  );
  const crewTechnicianIds = teamAppointments
    .filter((candidate) => candidate.technicianId !== technicianId)
    .map((candidate) => candidate.technicianId);
  const slot = buildScheduleSlot(
    start,
    bookingTiming(durationMinutes, bookingType).totalDurationMinutes,
  );
  const base = appointment
    ? ({
        appointmentId: appointment.id,
        bookingType,
        crewTechnicianIds,
        date,
        durationMinutes,
        end: slot.end,
        idempotencyKey: createClientCommandId("schedule"),
        kind: "appointment",
        oldDate: appointment.date ?? date,
        oldEnd: appointment.end,
        oldStart: appointment.start,
        oldTechnicianId: appointment.technicianId,
        scheduleGroupId: appointment.scheduleGroupId ?? appointment.id,
        start: slot.start,
        technicianId,
        warnings: [],
      } satisfies PendingSchedule)
    : ({
        bookingType,
        crewTechnicianIds,
        date,
        durationMinutes,
        end: slot.end,
        idempotencyKey: createClientCommandId("schedule"),
        kind: "request",
        requestId: request.id,
        start: slot.start,
        technicianId,
        warnings: [],
      } satisfies PendingSchedule);

  return recalculatePending({ dashboard, pending: base, request });
}

function recalculatePending({
  dashboard,
  pending,
  request,
}: {
  dashboard: DispatchDashboardData;
  pending: PendingSchedule;
  request: DispatchRequest;
}): PendingSchedule {
  const slot = buildScheduleSlot(
    pending.start,
    bookingTiming(
      pending.durationMinutes,
      pending.bookingType,
    ).totalDurationMinutes,
  );
  const travel = buildTravel(
    dashboard,
    request,
    pending.technicianId,
    pending.bookingType,
  );
  const travelAppointment = applyTravelToAppointment(
    {
      bookingType: pending.bookingType,
      customer: request.customer,
      date: pending.date,
      end: slot.end,
      id:
        pending.kind === "appointment" ? pending.appointmentId : "pending-queue",
      requestId: request.id,
      siteAddress: request.siteAddress,
      siteArea: request.siteArea,
      siteTown: request.siteTown,
      source: "linked",
      start: slot.start,
      status: "tentative",
      technicianId: pending.technicianId,
      title: request.subject,
    },
    travel,
  );

  return {
    ...pending,
    end: slot.end,
    start: slot.start,
    travel,
    warnings: detectScheduleWarnings({
      appointmentId:
        pending.kind === "appointment" ? pending.appointmentId : undefined,
      appointments: dashboard.appointments,
      date: pending.date,
      end: slot.end,
      selectedDateIsPast: selectedDateIsPast(pending.date),
      start: slot.start,
      technician: dashboard.technicians.find(
        (technician) => technician.id === pending.technicianId,
      ),
      technicianId: pending.technicianId,
      travelAppointment,
    }),
  };
}

function buildTravel(
  dashboard: DispatchDashboardData,
  request: DispatchRequest,
  technicianId: string,
  bookingType: BookingType,
): TravelEstimate | undefined {
  return buildAppointmentTravel({
    request: applyBookingTypeToRequest(request, bookingType),
    technician: dashboard.technicians.find(
      (technician) => technician.id === technicianId,
    ),
  });
}

function requestScheduleAppointments(
  appointments: Appointment[],
  requestId: string,
  anchor?: Appointment,
) {
  const candidates = appointments.filter(
    (appointment) => appointment.requestId === requestId,
  );
  if (!anchor) return candidates;
  return candidates.filter((candidate) =>
    anchor.scheduleGroupId
      ? candidate.scheduleGroupId === anchor.scheduleGroupId
      : candidate.date === anchor.date &&
        candidate.start === anchor.start &&
        candidate.end === anchor.end,
  );
}

function canUseLiveSchedule(
  dashboard: DispatchDashboardData,
  request: DispatchRequest,
) {
  return (
    request.sourceSystem === "msp-central" &&
    dashboard.dispatchDataSource === "msp-central" &&
    dashboard.calendarDataSource === "outlook" &&
    dashboard.calendarReadOnly === false
  );
}

function technicianLabel(technicians: Technician[], technicianId: string) {
  return (
    technicians.find((technician) => technician.id === technicianId)
      ?.displayName ?? "Unknown technician"
  );
}

function technicianOutlookIdentity(
  technicians: Technician[],
  technicianId: string,
) {
  const technician = technicians.find(
    (candidate) => candidate.id === technicianId,
  );
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
  const technician = technicians.find(
    (candidate) => candidate.id === technicianId,
  );
  return technician?.mspCentralEmail ?? technician?.zohoEmail;
}

function technicianMspCentralId(
  technicians: Technician[],
  technicianId: string,
) {
  return technicians.find((candidate) => candidate.id === technicianId)
    ?.mspCentralTechnicianId ?? undefined;
}

function createClientCommandId(prefix: string) {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${id}`;
}

function scheduleReceiptMessage(requestNumber: string, status?: string) {
  if (status === "review_required") {
    return `${requestNumber} was saved locally, but provider sync needs review.`;
  }
  if (status === "synced") {
    return `${requestNumber} scheduled in MSP Central and Outlook.`;
  }
  return `${requestNumber} scheduled. Syncing with MSP Central and Outlook.`;
}

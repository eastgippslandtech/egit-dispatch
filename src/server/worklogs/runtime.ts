import type { MicrosoftGraphEvent } from "@/server/graph/types";

import type { WorklogDispositionCommand } from "./disposition";

type RuntimeMspClient = {
  addRequestWorklog?: (input: {
    description: string;
    durationMinutes: number;
    endedAt: string;
    requestId: string;
    startedAt: string;
  }) => Promise<void>;
  assignRequest: (input: {
    requestId: string;
    technicianName: string;
  }) => Promise<void>;
  clearRequestSchedule: (input: { requestId: string }) => Promise<void>;
  updateRequestSchedule: (input: {
    requestId: string;
    scheduledEnd: string;
    scheduledStart: string;
    technicianEmail?: string;
    technicianName?: string;
  }) => Promise<void>;
  updateRequestStatus?: (input: {
    requestId: string;
    status: string;
  }) => Promise<void>;
};

type RuntimeGraphClient = {
  createEvent: (input: GraphEventInput) => Promise<MicrosoftGraphEvent>;
  deleteEvent: (input: {
    eventId: string;
    userPrincipalName: string;
  }) => Promise<void>;
  updateEvent: (
    input: GraphEventInput & { eventId: string },
  ) => Promise<MicrosoftGraphEvent>;
};

type GraphEventInput = {
  bodyPreview?: string;
  end: string;
  location?: string;
  start: string;
  subject: string;
  transactionId?: string;
  userPrincipalName: string;
};

export interface WorklogOutcomeStore {
  bookForward(input: {
    end: string;
    eventId?: string;
    outlookCalendarEmail: string;
    requestId: string;
    requestNumber: string;
    start: string;
    technicianEmail?: string;
    technicianId: string;
  }): Promise<void>;
  clearSchedule(input: {
    requestId: string;
    status: "sdp_only" | "linked";
  }): Promise<void>;
  transfer(input: {
    reason: string;
    requestId: string;
    targetEmail?: string;
    targetTechnicianId: string;
  }): Promise<void>;
}

export function createWorklogDispositionRuntime({
  graphClient,
  mspClient,
  outcomeStore,
}: {
  graphClient: RuntimeGraphClient;
  mspClient: RuntimeMspClient;
  outcomeStore: WorklogOutcomeStore;
}) {
  return {
    async saveWorklog(command: WorklogDispositionCommand) {
      if (!mspClient.addRequestWorklog) {
        throw new Error("MSP Central Work Log writeback is unavailable.");
      }
      await mspClient.addRequestWorklog({
        description: command.description,
        durationMinutes: command.durationMinutes,
        endedAt: command.endedAt,
        requestId: command.requestId,
        startedAt: command.startedAt,
      });
    },

    async applyDisposition(command: WorklogDispositionCommand) {
      if (command.disposition === "complete") {
        if (!mspClient.updateRequestStatus) {
          throw new Error("MSP Central status writeback is unavailable.");
        }
        await mspClient.updateRequestStatus({
          requestId: command.requestId,
          status: "Resolved",
        });
        await mspClient.clearRequestSchedule({ requestId: command.requestId });
        await removeCurrentCalendarEvent(command, graphClient);
        await outcomeStore.clearSchedule({
          requestId: command.requestId,
          status: "sdp_only",
        });
        return;
      }

      if (command.disposition === "return_to_queue") {
        await mspClient.clearRequestSchedule({ requestId: command.requestId });
        await removeCurrentCalendarEvent(command, graphClient);
        await outcomeStore.clearSchedule({
          requestId: command.requestId,
          status: "sdp_only",
        });
        return;
      }

      if (command.disposition === "transfer_escalate" && command.transfer) {
        await mspClient.assignRequest({
          requestId: command.requestId,
          technicianName:
            command.transfer.targetTechnicianName ??
            command.transfer.targetEmail ??
            command.transfer.targetTechnicianId,
        });
        await mspClient.clearRequestSchedule({ requestId: command.requestId });
        await removeCurrentCalendarEvent(command, graphClient);
        await outcomeStore.transfer({
          reason: command.transfer.reason,
          requestId: command.requestId,
          targetEmail: command.transfer.targetEmail,
          targetTechnicianId: command.transfer.targetTechnicianId,
        });
        return;
      }

      if (command.disposition === "book_forward" && command.booking) {
        const booking = command.booking;
        await mspClient.updateRequestSchedule({
          requestId: command.requestId,
          scheduledEnd: withMelbourneOffset(booking.date, booking.end),
          scheduledStart: withMelbourneOffset(booking.date, booking.start),
          technicianEmail: booking.technicianEmail,
          technicianName: booking.technicianName,
        });

        const graphInput: GraphEventInput = {
          bodyPreview: [
            `Request: ${booking.requestNumber}`,
            booking.customer ? `Company: ${booking.customer}` : undefined,
            booking.location ? `Site: ${booking.location}` : undefined,
            `Booking Type: ${booking.bookingType}`,
          ]
            .filter(Boolean)
            .join("\n"),
          end: `${booking.date}T${booking.end}:00`,
          location: booking.location,
          start: `${booking.date}T${booking.start}:00`,
          subject: `${booking.requestNumber} ${booking.subject}`.trim(),
          transactionId: command.idempotencyKey,
          userPrincipalName: booking.userPrincipalName,
        };
        const current = command.currentBooking;
        let event: MicrosoftGraphEvent;

        if (
          current?.eventId &&
          current.userPrincipalName === booking.userPrincipalName
        ) {
          event = await graphClient.updateEvent({
            ...graphInput,
            eventId: current.eventId,
            transactionId: undefined,
          });
        } else {
          await removeCurrentCalendarEvent(command, graphClient);
          event = await graphClient.createEvent(graphInput);
        }

        await outcomeStore.bookForward({
          end: withMelbourneOffset(booking.date, booking.end),
          eventId: event.id,
          outlookCalendarEmail: booking.userPrincipalName,
          requestId: command.requestId,
          requestNumber: booking.requestNumber,
          start: withMelbourneOffset(booking.date, booking.start),
          technicianEmail: booking.technicianEmail,
          technicianId: booking.technicianId,
        });
      }
    },
  };
}

async function removeCurrentCalendarEvent(
  command: WorklogDispositionCommand,
  graphClient: RuntimeGraphClient,
) {
  const current = command.currentBooking;
  if (!current?.eventId || !current.userPrincipalName) return;
  await graphClient.deleteEvent({
    eventId: current.eventId,
    userPrincipalName: current.userPrincipalName,
  });
}

function withMelbourneOffset(date: string, time: string) {
  const month = Number(date.slice(5, 7));
  const offset = month >= 4 && month <= 9 ? "+10:00" : "+11:00";
  return `${date}T${time}:00${offset}`;
}

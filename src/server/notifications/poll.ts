import type { DispatchRequest } from "@/server/dispatch/types";
import type { MspCentralClient } from "@/server/msp-central/types";
import { getInitialStaffProfiles } from "@/server/staff/profiles";

import type {
  NotificationDelivery,
  NotificationRequestState,
} from "./repository";
import {
  sendExpoPushNotification,
  type PushMessage,
} from "./push";

const AUTO_ASSIGNMENT_WARNING =
  "Auto-assigned by Advanced Works/Viridian IT site proximity.";

export type NotificationRepository = {
  getState(requestId: string): Promise<NotificationRequestState | undefined>;
  getStates?(
    requestIds: string[],
  ): Promise<Map<string, NotificationRequestState>>;
  listPushTokens(technicianId: string): Promise<string[]>;
  listPushTokensByTechnician?(
    technicianIds: string[],
  ): Promise<Map<string, string[]>>;
  recordDelivery(input: NotificationDelivery): Promise<void>;
  saveState(state: NotificationRequestState): Promise<void>;
  saveStates?(states: NotificationRequestState[]): Promise<void>;
};

export async function processTechnicianNotifications({
  client,
  now = new Date(),
  repository,
  sendPush = sendExpoPushNotification,
}: {
  client: MspCentralClient;
  now?: Date;
  repository: NotificationRepository;
  sendPush?: (message: PushMessage) => Promise<{ receiptId?: string }>;
}) {
  const requests = await client.listRequests();
  const requestIds = requests.map((request) => request.id);
  const technicianIds = [
    ...new Set(
      requests
        .map((request) => request.technicianId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const states = repository.getStates
    ? await repository.getStates(requestIds)
    : undefined;
  const pushTokens = repository.listPushTokensByTechnician
    ? await repository.listPushTokensByTechnician(technicianIds)
    : undefined;
  const nextStates: NotificationRequestState[] = [];
  let sent = 0;
  let skipped = 0;

  for (const request of requests) {
    const previous = states
      ? states.get(request.id)
      : await repository.getState(request.id);
    const state = requestState(request);
    const event = notificationEvent(request, previous, now);

    if (!event || !request.technicianId) {
      if (repository.saveStates) {
        nextStates.push(state);
      } else {
        await repository.saveState(state);
      }
      skipped += 1;
      continue;
    }

    if (event.type === "after_hours_assignment") {
      await client.assignRequest({
        requestId: request.id,
        technicianName: technicianName(request.technicianId),
      });
    }

    const tokens = pushTokens
      ? (pushTokens.get(request.technicianId) ?? [])
      : await repository.listPushTokens(request.technicianId);
    const title = event.title;
    const body = `${request.requestNumber}: ${request.subject}`;
    const eventKey = [
      request.id,
      event.type,
      request.technicianId,
      state.fingerprint,
    ].join(":");
    let providerReceiptId: string | undefined;
    let deliveryStatus: NotificationDelivery["status"] =
      tokens.length > 0 ? "sent" : "no_device";

    for (const token of tokens) {
      try {
        const result = await sendPush({
          body,
          data: {
            eventType: event.type,
            requestId: request.id,
            requestNumber: request.requestNumber,
          },
          title,
          to: token,
        });
        providerReceiptId ??= result.receiptId;
        sent += 1;
      } catch (error) {
        deliveryStatus = "failed";
        console.error("Technician push notification failed", {
          message: error instanceof Error ? error.message : "Unknown push error",
          requestId: request.id,
          technicianId: request.technicianId,
        });
      }
    }

    await repository.recordDelivery({
      body,
      eventKey,
      eventType: event.type,
      providerReceiptId,
      requestId: request.id,
      status: deliveryStatus,
      technicianId: request.technicianId,
      title,
    });
    if (repository.saveStates) {
      nextStates.push(state);
    } else {
      await repository.saveState(state);
    }
  }

  if (repository.saveStates && nextStates.length > 0) {
    await repository.saveStates(nextStates);
  }

  return { observed: requests.length, sent, skipped };
}

function notificationEvent(
  request: DispatchRequest,
  previous: NotificationRequestState | undefined,
  now: Date,
) {
  if (!previous) {
    if (isSelfUpdate(request)) {
      return undefined;
    }
    if (
      request.ageHours <= 1 &&
      request.warnings.includes(AUTO_ASSIGNMENT_WARNING) &&
      isAfterHours(now)
    ) {
      return {
        title: "After-hours ticket assigned",
        type: "after_hours_assignment",
      };
    }
    if (isAfterHours(now) && !isAfterHoursExemptRequest(request)) {
      return undefined;
    }
    if (request.ageHours <= 1 && request.technicianId) {
      return { title: "Ticket assigned", type: "assignment" };
    }
    return undefined;
  }

  if (previous.fingerprint === requestState(request).fingerprint) {
    return undefined;
  }
  if (isSelfUpdate(request)) {
    return undefined;
  }
  if (isAfterHours(now) && !isAfterHoursExemptRequest(request)) {
    return undefined;
  }
  if (previous.technicianId !== request.technicianId) {
    return { title: "Ticket assigned", type: "assignment" };
  }
  if (
    previous.scheduledStart !== request.scheduledStart ||
    previous.scheduledEnd !== request.scheduledEnd
  ) {
    return { title: "Schedule changed", type: "schedule_changed" };
  }
  if (previous.priority !== request.priority) {
    return { title: "Ticket priority changed", type: "priority_changed" };
  }
  if (previous.status !== request.status) {
    return { title: "Ticket status changed", type: "status_changed" };
  }
  return { title: "Ticket updated", type: "ticket_updated" };
}

function requestState(request: DispatchRequest): NotificationRequestState {
  const state = {
    priority: request.priority,
    requestId: request.id,
    requestNumber: request.requestNumber,
    scheduledEnd: request.scheduledEnd,
    scheduledStart: request.scheduledStart,
    status: request.status,
    technicianId: request.technicianId,
    updatedAt: request.updatedAt,
    updatedByEmail: request.updatedByEmail,
  };

  return {
    ...state,
    fingerprint: JSON.stringify(state),
  };
}

function isSelfUpdate(request: DispatchRequest) {
  if (!request.technicianId || !request.updatedByEmail) {
    return false;
  }

  const profile = getInitialStaffProfiles().find(
    (candidate) =>
      `tech-${candidate.displayName.toLowerCase()}` === request.technicianId,
  );

  return Boolean(
    profile &&
      [
        profile.zohoEmail,
        profile.mspCentralEmail,
        profile.outlookEmail,
      ].some(
        (email) =>
          email.toLowerCase() === request.updatedByEmail?.trim().toLowerCase(),
      ),
  );
}

function technicianName(technicianId: string) {
  const names: Record<string, string> = {
    "tech-jervy": "Jervy",
    "tech-matt": "Matt",
    "tech-riley": "Riley",
    "tech-simeon": "Simeon",
  };
  return names[technicianId] ?? technicianId;
}

function isAfterHours(now: Date) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "Australia/Melbourne",
    weekday: "short",
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const workday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday ?? "");
  const minutes = hour * 60 + minute;

  return !workday || minutes < 9 * 60 || minutes >= 17 * 60;
}

function isAfterHoursExemptRequest(request: DispatchRequest) {
  const customer = request.customer.trim().toLowerCase();
  return (
    customer.includes("advanced works") ||
    customer.includes("advancedworks") ||
    customer.includes("viridian")
  );
}

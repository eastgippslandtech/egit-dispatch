import type { NotificationDelivery } from "@/server/notifications/repository";
import {
  sendExpoPushNotification,
  type PushMessage,
} from "@/server/notifications/push";

import { PermanentIntegrationError } from "../errors";
import type { IntegrationStepAdapter } from "../registry";

type PushNotificationRepository = {
  listPushTokens(technicianId: string): Promise<string[]>;
  recordDelivery(input: NotificationDelivery): Promise<void>;
};

export function createPushNotificationAdapters({
  now = () => new Date(),
  repository,
  sendPush = sendExpoPushNotification,
}: {
  now?: () => Date;
  repository?: PushNotificationRepository | null;
  sendPush?: (message: PushMessage) => Promise<{ receiptId?: string }>;
}): Record<string, IntegrationStepAdapter> {
  return {
    "push.notify": {
      writeSafety: "idempotent",
      async execute(step) {
        if (!repository) {
          throw new PermanentIntegrationError(
            "Command Centre push notifications are unavailable.",
          );
        }

        const requestId = requiredString(step.payload, "requestId");
        const requestNumber = requiredString(step.payload, "requestNumber");
        const technicianId = requiredString(step.payload, "technicianId");
        const eventType = requiredString(step.payload, "eventType");
        const eventKey = requiredString(step.payload, "eventKey");
        const title = requiredString(step.payload, "title");
        const body = requiredString(step.payload, "body");
        const customer = optionalString(step.payload, "customer");

        if (isAfterHours(now()) && !isAfterHoursExemptCustomer(customer)) {
          await repository.recordDelivery({
            body,
            eventKey,
            eventType,
            requestId,
            status: "no_device",
            technicianId,
            title,
          });
          return { delivered: 0, status: "quiet_hours" };
        }

        const tokens = await repository.listPushTokens(technicianId);
        let delivered = 0;
        let failed = 0;
        const failureMessages: string[] = [];
        let providerReceiptId: string | undefined;

        for (const token of tokens) {
          try {
            const result = await sendPush({
              body,
              data: { eventType, requestId, requestNumber },
              title,
              to: token,
            });
            delivered += 1;
            providerReceiptId ??= result.receiptId;
          } catch (error) {
            failed += 1;
            failureMessages.push(safePushFailure(error));
          }
        }

        const status =
          tokens.length === 0 ? "no_device" : delivered > 0 ? "sent" : "failed";
        await repository.recordDelivery({
          body,
          eventKey,
          eventType,
          providerReceiptId,
          requestId,
          status,
          technicianId,
          title,
        });

        return {
          delivered,
          failure: failureMessages[0],
          failed,
          status,
        };
      },
    },
  };
}

function requiredString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new PermanentIntegrationError(`${key} is required.`);
  }
  return value.trim();
}

function optionalString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safePushFailure(error: unknown) {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : "Technician push delivery failed.";
  return message.replace(/\s+/g, " ").trim().slice(0, 200);
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

function isAfterHoursExemptCustomer(customer?: string) {
  const normalized = customer?.trim().toLowerCase() ?? "";
  return (
    normalized.includes("advanced works") ||
    normalized.includes("advancedworks") ||
    normalized.includes("viridian")
  );
}

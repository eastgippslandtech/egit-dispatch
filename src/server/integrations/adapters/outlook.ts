import { cleanRequestTitle } from "@/server/dispatch/request-title";
import type { MicrosoftGraphEvent } from "@/server/graph/types";

import { PermanentIntegrationError } from "../errors";
import type { IntegrationStepAdapter } from "../registry";
import type { IntegrationOperationStep } from "../types";

type OutlookGraphClient = {
  createEvent(input: GraphWriteInput): Promise<MicrosoftGraphEvent>;
  deleteEvent(input: {
    eventId: string;
    userPrincipalName: string;
  }): Promise<void>;
  updateEvent(
    input: GraphWriteInput & { eventId: string },
  ): Promise<MicrosoftGraphEvent>;
};

type GraphWriteInput = {
  bodyPreview?: string;
  end: string;
  location?: string;
  start: string;
  subject: string;
  transactionId?: string;
  userPrincipalName: string;
};

export function createOutlookAdapters({
  graphClient,
}: {
  graphClient: OutlookGraphClient;
}): Record<string, IntegrationStepAdapter> {
  return {
    "outlook.delete_event": {
      async execute(step) {
        const eventId = requiredString(step.payload, "eventId");
        const userPrincipalName = requiredString(
          step.payload,
          "userPrincipalName",
        );
        await graphClient.deleteEvent({ eventId, userPrincipalName });
        return { deleted: true, externalId: eventId };
      },
      writeSafety: "idempotent",
    },
    "outlook.upsert_event": {
      async execute(step) {
        const input = graphWriteInput(step);
        const eventId = optionalString(step.payload, "eventId");
        const event = eventId
          ? await graphClient.updateEvent({
              ...input,
              eventId,
              transactionId: undefined,
            })
          : await graphClient.createEvent({
              ...input,
              transactionId: requiredString(step.payload, "transactionId"),
            });
        const externalId = String(event.id ?? eventId ?? "").trim();
        if (!externalId) {
          throw new PermanentIntegrationError(
            "Microsoft Graph did not return an event ID.",
          );
        }
        return {
          bookingIdentity: requiredString(step.payload, "appointmentId"),
          commandCreated: true,
          externalId,
          ...(event.webLink ? { webLink: event.webLink } : {}),
        };
      },
      writeSafety: "idempotent",
    },
  };
}

function graphWriteInput(step: IntegrationOperationStep): GraphWriteInput {
  const requestNumber = optionalString(step.payload, "requestNumber");
  const subject = requiredString(step.payload, "subject");
  return {
    bodyPreview: optionalString(step.payload, "bodyPreview"),
    end: requiredDate(step.payload, "end"),
    location: optionalString(step.payload, "location"),
    start: requiredDate(step.payload, "start"),
    subject: cleanRequestTitle(subject, requestNumber) || subject,
    transactionId: optionalString(step.payload, "transactionId"),
    userPrincipalName: requiredString(step.payload, "userPrincipalName"),
  };
}

function requiredString(payload: Record<string, unknown>, key: string) {
  const value = optionalString(payload, key);
  if (!value) throw new PermanentIntegrationError(`${key} is required.`);
  return value;
}

function optionalString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredDate(payload: Record<string, unknown>, key: string) {
  const value = requiredString(payload, key);
  if (!Number.isFinite(new Date(value).getTime())) {
    throw new PermanentIntegrationError(`${key} is invalid.`);
  }
  return value;
}

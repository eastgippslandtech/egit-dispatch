import type {
  DispatchCrewLinkInput,
  DispatchLinkInput,
  DispatchLinkStore,
} from "@/server/dispatch/link-store";
import type { BookingType, Priority } from "@/server/dispatch/types";
import type { WorklogOutcomeStore } from "@/server/worklogs/runtime";

import { PermanentIntegrationError } from "../errors";
import type { IntegrationStepAdapter, IntegrationStepResult } from "../registry";

export type IntegrationStepResultReader = {
  getStepResults(
    operationId: string,
  ): Promise<Record<string, IntegrationStepResult>>;
};

export function createCommandCentreAdapters({
  dispatchLinkStore,
  invalidate,
  outcomeStore,
  resultReader,
}: {
  dispatchLinkStore?: DispatchLinkStore | null;
  invalidate?: (requestIds: string[]) => Promise<void>;
  outcomeStore?: WorklogOutcomeStore;
  resultReader?: IntegrationStepResultReader;
}): Record<string, IntegrationStepAdapter> {
  return {
    "command_centre.clear_schedule": idempotent(async (step) => {
      if (!outcomeStore) unavailable("schedule outcome persistence");
      const requestId = requiredString(step.payload, "requestId");
      await outcomeStore!.clearSchedule({ requestId, status: "sdp_only" });
      return { cleared: true };
    }),
    "command_centre.invalidate_request": idempotent(async (step) => {
      if (!invalidate) unavailable("request refresh invalidation");
      const requestIds = stringArray(step.payload.relatedRequestIds);
      const fallback = requiredString(step.payload, "requestId");
      const unique = [...new Set(requestIds.length ? requestIds : [fallback])];
      await invalidate!(unique);
      return { invalidatedRequestCount: unique.length };
    }),
    "command_centre.invalidate_created_request": idempotent(async (step) => {
      if (!invalidate || !resultReader) {
        unavailable("created-request refresh invalidation");
      }
      const providerStepKey = requiredString(
        step.payload,
        "providerStepKey",
      );
      const results = await resultReader!.getStepResults(step.operationId);
      const requestId = requiredString(
        results[providerStepKey] ?? {},
        "externalId",
      );
      await invalidate!([requestId]);
      return { externalId: requestId, invalidatedRequestCount: 1 };
    }),
    "command_centre.persist_book_forward": idempotent(async (step) => {
      if (!outcomeStore || !resultReader) {
        unavailable("book-forward persistence");
      }
      const booking = requiredRecord(step.payload, "booking");
      const results = await resultReader!.getStepResults(step.operationId);
      const eventId = optionalString(
        results["outlook:book-forward"] ?? {},
        "externalId",
      );
      await outcomeStore!.bookForward({
        end: requiredString(step.payload, "scheduledEnd"),
        eventId,
        outlookCalendarEmail: requiredString(booking, "userPrincipalName"),
        requestId: requiredString(step.payload, "requestId"),
        requestNumber: requiredString(booking, "requestNumber"),
        start: requiredString(step.payload, "scheduledStart"),
        technicianEmail: optionalString(booking, "technicianEmail"),
        technicianId: requiredString(booking, "technicianId"),
      });
      return eventId ? { externalId: eventId } : {};
    }),
    "command_centre.persist_dispatch_link": idempotent(async (step) => {
      if (!dispatchLinkStore || !resultReader) {
        unavailable("dispatch-link persistence");
      }
      const payload = step.payload;
      const lead = requiredRecord(payload, "lead");
      const crew = recordArray(payload.crew);
      const outlookStepKeys = requiredRecord(payload, "outlookStepKeys");
      const leadStepKey = requiredString(outlookStepKeys, "lead");
      const crewStepKeys = stringArray(outlookStepKeys.crew);
      if (crewStepKeys.length !== crew.length) {
        throw new PermanentIntegrationError(
          "Outlook crew results do not match the scheduled crew.",
        );
      }
      const results = await resultReader!.getStepResults(step.operationId);
      const leadResult = results[leadStepKey];
      const leadEventId = optionalString(leadResult ?? {}, "externalId");
      if (!leadEventId) {
        throw new PermanentIntegrationError(
          "The lead Outlook event ID is unavailable.",
        );
      }
      const crewLinks: DispatchCrewLinkInput[] = crew.map((member, index) => {
        const eventId = optionalString(
          results[crewStepKeys[index]!] ?? {},
          "externalId",
        );
        if (!eventId) {
          throw new PermanentIntegrationError(
            "A crew Outlook event ID is unavailable.",
          );
        }
        return {
          outlookCalendarEmail: requiredString(member, "userPrincipalName"),
          outlookEventId: eventId,
          syncStatus: "linked",
          technicianEmail: optionalString(member, "technicianEmail"),
          technicianId: requiredString(member, "technicianId"),
        };
      });
      const input: DispatchLinkInput = {
        action: "live_schedule",
        bookingType: optionalBookingType(payload.bookingType),
        crew: crewLinks,
        customer: optionalString(payload, "customer"),
        outlookCalendarEmail: requiredString(lead, "userPrincipalName"),
        outlookEventId: leadEventId,
        priority: optionalPriority(payload.priority),
        requestId: requiredString(payload, "requestId"),
        requestNumber: requiredString(payload, "requestNumber"),
        scheduledEnd: requiredString(payload, "scheduledEnd"),
        scheduledStart: requiredString(payload, "scheduledStart"),
        siteAddress: optionalString(payload, "location"),
        siteName: optionalString(payload, "location"),
        subject: requiredString(payload, "subject"),
        syncStatus: "linked",
        technicianEmail: optionalString(lead, "technicianEmail"),
        technicianId: requiredString(lead, "technicianId"),
        technicianMspCentralId: optionalString(
          lead,
          "mspCentralTechnicianId",
        ),
      };
      await dispatchLinkStore!.save(input);
      return {
        crewEventCount: crewLinks.length,
        externalId: leadEventId,
        linked: true,
      };
    }),
    "command_centre.persist_transfer": idempotent(async (step) => {
      if (!outcomeStore) unavailable("transfer persistence");
      await outcomeStore!.transfer({
        reason: requiredString(step.payload, "reason"),
        requestId: requiredString(step.payload, "requestId"),
        targetEmail: optionalString(step.payload, "targetEmail"),
        targetTechnicianId: requiredString(
          step.payload,
          "targetTechnicianId",
        ),
      });
      return { transferred: true };
    }),
  };
}

function idempotent(
  execute: IntegrationStepAdapter["execute"],
): IntegrationStepAdapter {
  return { execute, writeSafety: "idempotent" };
}

function unavailable(capability: string): never {
  throw new PermanentIntegrationError(
    `Command Centre ${capability} is unavailable.`,
  );
}

function requiredRecord(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PermanentIntegrationError(`${key} is required.`);
  }
  return value as Record<string, unknown>;
}

function recordArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  if (
    value.some(
      (entry) => !entry || typeof entry !== "object" || Array.isArray(entry),
    )
  ) {
    throw new PermanentIntegrationError("Crew data is invalid.");
  }
  return value as Record<string, unknown>[];
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && Boolean(entry.trim()),
      )
    : [];
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

function optionalBookingType(value: unknown): BookingType | undefined {
  return value === "Remote" || value === "Onsite" || value === "In house"
    ? value
    : undefined;
}

function optionalPriority(value: unknown): Priority | undefined {
  return value === "Critical" ||
    value === "High" ||
    value === "Medium" ||
    value === "Low"
    ? value
    : undefined;
}

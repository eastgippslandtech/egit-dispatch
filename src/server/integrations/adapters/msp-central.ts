import type {
  MspCentralClient,
  MspCentralRawNotification,
  MspCentralRawRequestNote,
  MspCentralRawWorklog,
  MspCentralTimestamp,
} from "@/server/msp-central/types";
import { roundWorklogMinutes } from "@/server/worklogs/time";

import {
  AmbiguousIntegrationError,
  AuthenticationIntegrationError,
  ConflictIntegrationError,
  PermanentIntegrationError,
  RetryableIntegrationError,
} from "../errors";
import { fingerprintPayload } from "../fingerprint";
import type { IntegrationStepAdapter, IntegrationStepResult } from "../registry";
import type { IntegrationOperationStep } from "../types";

type MspCentralAdapters = Record<string, IntegrationStepAdapter>;

export function createMspCentralAdapters({
  client,
}: {
  client: MspCentralClient;
}): MspCentralAdapters {
  return {
    "msp.add_note": nonIdempotent(async (step) => {
      const payload = notePayload(step);
      if (!client.addRequestNote || !client.listRequestNotes) {
        throw new PermanentIntegrationError(
          "MSP Central communication writeback is unavailable.",
        );
      }
      return executeWithReconciliation({
        step,
        reconcile: async () =>
          reconcileNote(await client.listRequestNotes!(payload.requestId), payload),
        write: async () => {
          await client.addRequestNote!({
            description: payload.description,
            requestId: payload.requestId,
            visibility: payload.visibility,
          });
          return {};
        },
      });
    }),
    "msp.send_reply": nonIdempotent(async (step) => {
      const payload = notePayload(step);
      if (!client.addRequestReply || !client.listRequestNotifications) {
        throw new PermanentIntegrationError(
          "MSP Central email reply writeback is unavailable.",
        );
      }
      return executeWithReconciliation({
        step,
        reconcile: async () =>
          reconcileReply(
            await client.listRequestNotifications!(payload.requestId),
            payload,
          ),
        write: async () => {
          await client.addRequestReply!({
            description: payload.description,
            requestId: payload.requestId,
          });
          return {};
        },
      });
    }),
    "msp.add_worklog": nonIdempotent(async (step) => {
      const payload = worklogPayload(step);
      if (!client.addRequestWorklog || !client.listRequestWorklogs) {
        throw new PermanentIntegrationError(
          "MSP Central Work Log writeback is unavailable.",
        );
      }
      return executeWithReconciliation({
        step,
        reconcile: async () =>
          reconcileWorklog(
            await client.listRequestWorklogs!(payload.requestId),
            payload,
          ),
        write: async () => {
          await client.addRequestWorklog!({
            description: payload.description,
            durationMinutes: payload.durationMinutes,
            endedAt: payload.endedAt,
            ownerId: payload.ownerId,
            requestId: payload.requestId,
            startedAt: payload.startedAt,
            worklogType: payload.worklogType,
          });
          return {};
        },
      });
    }),
    "msp.assign_request": idempotent(async (step) => {
      const payload = assignmentPayload(step);
      await mappedWrite(() => client.assignRequest(payload));
      return {};
    }),
    "msp.clear_schedule": idempotent(async (step) => {
      const requestId = requiredString(step.payload, "requestId");
      await mappedWrite(() => client.clearRequestSchedule({ requestId }));
      return {};
    }),
    "msp.create_request": nonIdempotent(async (step) => {
      const payload = createRequestPayload(step);
      if (!client.createRequest || !client.findRequestByCommandFingerprint) {
        throw new PermanentIntegrationError(
          "MSP Central request creation reconciliation is unavailable.",
        );
      }
      return executeWithReconciliation({
        step,
        reconcile: async () => {
          const found = await client.findRequestByCommandFingerprint!(
            payload.commandFingerprint,
          );
          return found
            ? {
                externalId: found.id,
                requestNumber: found.requestNumber,
              }
            : undefined;
        },
        write: async () => {
          const created = await client.createRequest!(payload);
          return {
            externalId: created.id,
            requestNumber: created.requestNumber,
          };
        },
      });
    }),
    "msp.merge_requests": nonIdempotent(async (step) => {
      const childRequestId = requiredString(step.payload, "childRequestId");
      const parentRequestId = requiredString(step.payload, "parentRequestId");
      return executeWithReconciliation({
        step,
        reconcile: async () => undefined,
        write: async () => {
          await client.mergeRequests({ childRequestId, parentRequestId });
          return {};
        },
      });
    }),
    "msp.schedule_request": idempotent(async (step) => {
      const payload = schedulePayload(step);
      await mappedWrite(() => client.updateRequestSchedule(payload));
      return {};
    }),
    "msp.set_solution": idempotent(async (step) => {
      if (!client.setRequestResolution) {
        throw new PermanentIntegrationError(
          "MSP Central solution writeback is unavailable.",
        );
      }
      const content = requiredString(step.payload, "content");
      const requestId = requiredString(step.payload, "requestId");
      await mappedWrite(() =>
        client.setRequestResolution!({ content, requestId }),
      );
      return {};
    }),
    "msp.update_status": idempotent(async (step) => {
      if (!client.updateRequestStatus) {
        throw new PermanentIntegrationError(
          "MSP Central status writeback is unavailable.",
        );
      }
      const requestId = requiredString(step.payload, "requestId");
      const status = requiredString(step.payload, "status");
      await mappedWrite(() => client.updateRequestStatus!({ requestId, status }));
      return {};
    }),
  };
}

function idempotent(
  execute: IntegrationStepAdapter["execute"],
): IntegrationStepAdapter {
  return { execute, writeSafety: "idempotent" };
}

function nonIdempotent(
  execute: IntegrationStepAdapter["execute"],
): IntegrationStepAdapter {
  return { execute, writeSafety: "non_idempotent" };
}

async function mappedWrite(write: () => Promise<void>) {
  try {
    await write();
  } catch (error) {
    throw mapMspError(error);
  }
}

async function executeWithReconciliation({
  reconcile,
  step,
  write,
}: {
  reconcile: () => Promise<IntegrationStepResult | undefined>;
  step: IntegrationOperationStep;
  write: () => Promise<IntegrationStepResult>;
}) {
  if (step.requiresReconciliation) {
    try {
      const existing = await reconcile();
      if (existing) return { ...existing, reconciled: true };
    } catch (reconciliationError) {
      throw new AmbiguousIntegrationError(
        "MSP Central retry could not be reconciled safely.",
        { cause: reconciliationError },
      );
    }

    throw new AmbiguousIntegrationError(
      "MSP Central retry has an unknown prior outcome; manual review is required before another write.",
    );
  }

  try {
    return await write();
  } catch (error) {
    const mapped = mapMspError(error);
    if (!(mapped instanceof RetryableIntegrationError)) throw mapped;

    try {
      const existing = await reconcile();
      if (existing) return { ...existing, reconciled: true };
    } catch (reconciliationError) {
      throw new AmbiguousIntegrationError(
        "MSP Central write outcome could not be reconciled safely.",
        { cause: reconciliationError, httpStatus: mapped.httpStatus },
      );
    }

    throw new AmbiguousIntegrationError(
      "MSP Central may have accepted the write; manual review is required before retrying.",
      { cause: error, httpStatus: mapped.httpStatus },
    );
  }
}

function reconcileNote(
  notes: MspCentralRawRequestNote[],
  payload: ReturnType<typeof notePayload>,
) {
  const expectedFingerprint = contentFingerprint(payload.description);
  const match = notes.find(
    (note) =>
      Boolean(note.show_to_requester) === payload.showToRequester &&
      withinReconciliationWindow(
        timestampMilliseconds(note.created_time),
        new Date(payload.occurredAt).getTime(),
      ) &&
      contentFingerprint(note.description ?? "") === expectedFingerprint,
  );
  const externalId = String(match?.id ?? "").trim();
  return externalId ? { externalId } : undefined;
}

function reconcileReply(
  notifications: MspCentralRawNotification[],
  payload: ReturnType<typeof notePayload>,
) {
  const expectedFingerprint = contentFingerprint(payload.description);
  const match = notifications.find(
    (notification) =>
      notification.type?.trim().toLowerCase() === "reply" &&
      withinReconciliationWindow(
        timestampMilliseconds(notification.sent_time),
        new Date(payload.occurredAt).getTime(),
      ) &&
      contentFingerprint(notification.description ?? "") ===
        expectedFingerprint,
  );
  const externalId = String(match?.id ?? "").trim();
  return externalId ? { externalId } : undefined;
}

function reconcileWorklog(
  worklogs: MspCentralRawWorklog[],
  payload: ReturnType<typeof worklogPayload>,
) {
  const expectedFingerprint = contentFingerprint(payload.description);
  const expectedBillable = payload.worklogType === "billable";
  const match = worklogs.find((worklog) => {
    const ownerId = String(
      worklog.owner?.id ?? worklog.created_by?.id ?? "",
    ).trim();
    return (
      ownerId === payload.ownerId &&
      worklogMinutes(worklog) === payload.durationMinutes &&
      timestampMilliseconds(worklog.start_time) ===
        new Date(payload.startedAt).getTime() &&
      timestampMilliseconds(worklog.end_time) ===
        new Date(payload.endedAt).getTime() &&
      Boolean(worklog.is_billable) === expectedBillable &&
      contentFingerprint(worklog.description ?? "") === expectedFingerprint
    );
  });
  const externalId = String(match?.id ?? "").trim();
  return externalId ? { externalId } : undefined;
}

function notePayload(step: IntegrationOperationStep) {
  const visibility =
    step.payload.visibility === "internal" ? "internal" : "customer";
  return {
    description: requiredString(step.payload, "description"),
    occurredAt: requiredDate(step.payload, "occurredAt"),
    requestId: requiredString(step.payload, "requestId"),
    showToRequester: visibility === "customer",
    visibility,
  } as const;
}

function worklogPayload(step: IntegrationOperationStep) {
  const worklogType = step.payload.worklogType;
  if (
    worklogType !== "billable" &&
    worklogType !== "non_billable" &&
    worklogType !== "internal"
  ) {
    throw new PermanentIntegrationError("Work Log type is invalid.");
  }
  const durationMinutes = roundWorklogMinutes(
    requiredNumber(step.payload, "durationMinutes"),
  );
  return {
    description: requiredString(step.payload, "description"),
    durationMinutes,
    endedAt: requiredDate(step.payload, "endedAt"),
    ownerId: requiredString(step.payload, "ownerId"),
    requestId: requiredString(step.payload, "requestId"),
    startedAt: requiredDate(step.payload, "startedAt"),
    worklogType,
  } as const;
}

function schedulePayload(step: IntegrationOperationStep) {
  return {
    requestId: requiredString(step.payload, "requestId"),
    scheduledEnd: requiredDate(step.payload, "scheduledEnd"),
    scheduledStart: requiredDate(step.payload, "scheduledStart"),
    ...optionalStringProperties(step.payload, [
      "technicianEmail",
      "technicianId",
      "technicianName",
    ] as const),
  };
}

function assignmentPayload(step: IntegrationOperationStep) {
  const technicianName =
    optionalString(step.payload, "technicianName") ??
    optionalString(step.payload, "technicianEmail") ??
    optionalString(step.payload, "technicianId");
  if (!technicianName) {
    throw new PermanentIntegrationError("MSP technician assignment is missing.");
  }
  return {
    requestId: requiredString(step.payload, "requestId"),
    technicianEmail: optionalString(step.payload, "technicianEmail"),
    technicianName,
  };
}

function createRequestPayload(step: IntegrationOperationStep) {
  const priority = step.payload.priority;
  if (!isPriority(priority)) {
    throw new PermanentIntegrationError("Request priority is invalid.");
  }
  return {
    commandFingerprint: requiredString(step.payload, "commandFingerprint"),
    customer: optionalString(step.payload, "customer"),
    description: optionalString(step.payload, "description"),
    priority,
    requesterEmail: optionalString(step.payload, "requesterEmail"),
    site: optionalString(step.payload, "site"),
    subject: requiredString(step.payload, "subject"),
  };
}

function mapMspError(error: unknown) {
  if (
    error instanceof AmbiguousIntegrationError ||
    error instanceof AuthenticationIntegrationError ||
    error instanceof ConflictIntegrationError ||
    error instanceof PermanentIntegrationError ||
    error instanceof RetryableIntegrationError
  ) {
    return error;
  }
  const status = errorStatus(error);
  const message = safeProviderMessage(error);
  const options = { cause: error, httpStatus: status };
  if (status === 401 || status === 403) {
    return new AuthenticationIntegrationError(message, options);
  }
  if (/oauth refresh failed|api request was denied|access denied/i.test(message)) {
    return new AuthenticationIntegrationError(message, options);
  }
  if (status === 409) return new ConflictIntegrationError(message, options);
  if (isNetworkError(error) || status === 429 || (status && status >= 500)) {
    return new RetryableIntegrationError(message, options);
  }
  return new PermanentIntegrationError(message, options);
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  for (const key of ["status", "statusCode", "httpStatus"] as const) {
    const value = Reflect.get(error, key);
    if (typeof value === "number") return value;
  }
  const message = error instanceof Error ? error.message : "";
  const match = message.match(/status\s+(\d{3})/i);
  return match ? Number(match[1]) : undefined;
}

function isNetworkError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String(Reflect.get(error, "code") ?? "").toUpperCase();
  return (
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ETIMEDOUT",
    ].includes(code) ||
    ["AbortError", "TimeoutError"].includes(String(Reflect.get(error, "name"))) ||
    (error instanceof Error && /fetch|network|socket|timed?\s*out/i.test(error.message))
  );
}

function safeProviderMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "MSP Central request failed.";
  return message
    .replace(/\b(access_token|refresh_token|client_secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/authorization\s*:\s*[^\s,;]+/gi, "Authorization: [REDACTED]")
    .slice(0, 500);
}

function contentFingerprint(value: string) {
  return fingerprintPayload(
    value
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function worklogMinutes(worklog: MspCentralRawWorklog) {
  const hours = Number(worklog.time_spent?.hours ?? 0);
  const minutes = Number(worklog.time_spent?.minutes ?? 0);
  const total = hours * 60 + minutes;
  if (Number.isFinite(total) && total > 0) {
    return roundWorklogMinutes(total);
  }
  const start = timestampMilliseconds(worklog.start_time);
  const end = timestampMilliseconds(worklog.end_time);
  return roundWorklogMinutes((end - start) / 60_000);
}

function timestampMilliseconds(value?: MspCentralTimestamp | null) {
  const raw =
    value && typeof value === "object" ? value.value ?? value.display_value : value;
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string" || !raw.trim()) return Number.NaN;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : new Date(raw).getTime();
}

function withinReconciliationWindow(actual: number, expected: number) {
  return (
    Number.isFinite(actual) &&
    Number.isFinite(expected) &&
    Math.abs(actual - expected) <= 10 * 60_000
  );
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

function optionalStringProperties<const T extends readonly string[]>(
  payload: Record<string, unknown>,
  keys: T,
) {
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = optionalString(payload, key);
      return value ? [[key, value]] : [];
    }),
  ) as Partial<Record<T[number], string>>;
}

function requiredNumber(payload: Record<string, unknown>, key: string) {
  const value = Number(payload[key]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new PermanentIntegrationError(`${key} must be positive.`);
  }
  return value;
}

function requiredDate(payload: Record<string, unknown>, key: string) {
  const value = requiredString(payload, key);
  if (!Number.isFinite(new Date(value).getTime())) {
    throw new PermanentIntegrationError(`${key} is invalid.`);
  }
  return value;
}

function isPriority(value: unknown): value is "Critical" | "High" | "Medium" | "Low" {
  return value === "Critical" || value === "High" || value === "Medium" || value === "Low";
}

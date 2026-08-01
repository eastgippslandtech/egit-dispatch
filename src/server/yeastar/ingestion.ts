import { normalizeAustralianPhone } from "./phone";
import { attributeExternalTalkSegments, isReportableExternalCall } from "./talk-time";
import type { YeastarCallDirection, YeastarCallSegmentInput } from "./types";
import { matchPhoneToZohoCrm } from "@/server/zoho-crm/matching";
import type { ZohoCrmRecord } from "@/server/zoho-crm/client";

type CdrRecord = Record<string, unknown>;
type StaffMapping = { staffId: string };

export function normalizeYeastarCdr(
  detail: CdrRecord,
  staffByExtension = new Map<string, StaffMapping>(),
) {
  const basic = record(detail.basic);
  const callType = text(basic.call_type) || "Unknown";
  const status = text(basic.last_status).toUpperCase();
  const timeline = array(detail.timeline).map(record);
  const direction = directionFrom(callType);
  const externalNumber =
    direction === "inbound"
      ? text(basic.call_from_number)
      : text(basic.call_to_number);
  const segments = attributeExternalTalkSegments(
    timeline.flatMap((leg): YeastarCallSegmentInput[] => {
      const legStatus = text(leg.status).toUpperCase();
      const trunk = text(leg.src_trunk) || text(leg.dst_trunk);
      const extension =
        direction === "inbound"
          ? text(leg.call_to_number)
          : text(leg.call_from_number);
      const talkSeconds = Math.max(
        0,
        number(leg.talk_duration) - number(leg.hold_duration),
      );
      if (
        legStatus !== "ANSWERED" ||
        !trunk ||
        !extension ||
        talkSeconds <= 0
      ) {
        return [];
      }
      const startedAt = parsePbxDate(text(leg.time));
      const connectedAt = addSeconds(startedAt, number(leg.ring_duration));
      return [{
        connectedAt,
        disconnectedAt: addSeconds(connectedAt, talkSeconds),
        extension,
        rawMetadata: safeMetadata(leg),
        segmentId:
          text(leg.cdr_id) ||
          text(leg.transaction_id) ||
          `${text(basic.uid)}-${text(leg.leg)}-${extension}`,
        staffId: staffByExtension.get(extension)?.staffId,
        talkSeconds,
      }];
    }),
  );
  const connectedTalkSeconds = segments.reduce(
    (total, segment) => total + segment.talkSeconds,
    0,
  );

  if (
    !isReportableExternalCall({
      answered: status === "ANSWERED",
      callType,
      connectedTalkSeconds,
      hasExternalParty: Boolean(normalizeAustralianPhone(externalNumber)),
      hasTrunk: timeline.some(
        (leg) => Boolean(text(leg.src_trunk) || text(leg.dst_trunk)),
      ),
    })
  ) {
    return undefined;
  }

  const startedAt = parsePbxDate(text(basic.time));
  const callDuration = Math.max(
    number(basic.call_duration),
    number(basic.talk_duration),
  );
  const callId = text(basic.uid);
  return {
    answeredAt: addSeconds(startedAt, number(basic.ring_duration)),
    callId,
    callStatus: status,
    cdrId: callId,
    connectedTalkSeconds,
    direction,
    endedAt: addSeconds(startedAt, callDuration),
    externalNumber,
    normalisedExternalNumber: normalizeAustralianPhone(externalNumber),
    rawMetadata: safeMetadata({ basic }),
    segmentAttributionAvailable: segments.length > 0,
    segments,
    startedAt,
    transcriptStatus: "awaiting_transcript" as const,
  };
}

export async function processPendingYeastarEvents({
  client,
  crmClient,
  repository,
}: {
  client: {
    getAiContext(uid: string): Promise<Record<string, unknown>>;
    getAiSummary(uid: string): Promise<Record<string, unknown>>;
    getCdrDetail(uid: string): Promise<Record<string, unknown>>;
  };
  crmClient?: {
    searchAccountsByPhone(phone: string): Promise<ZohoCrmRecord[]>;
    searchContactsByPhone(phone: string): Promise<ZohoCrmRecord[]>;
  };
  repository: {
    findPhoneMapping?(phone: string): Promise<{
      accountId: string | null;
      contactId: string | null;
      contactName: string | null;
      customerName: string | null;
    } | undefined>;
    finishEvent(id: string, error?: string): Promise<void>;
    listPendingEvents(limit?: number): Promise<Array<{
      callId: string | null;
      id: string;
      payload: Record<string, unknown>;
    }>>;
    listStaffMappings(): Promise<Array<{ extension: string; staffId: string }>>;
    savePhoneMapping?(input: {
      accountId?: string;
      contactId?: string;
      contactName?: string;
      customerName?: string;
      phone: string;
    }): Promise<void>;
    updateTranscript(input: {
      actionItems?: unknown[];
      callId: string;
      error?: string;
      status: "complete" | "awaiting_transcript";
      summary?: string;
      transcript?: string;
    }): Promise<void>;
    upsertCall(input: ReturnType<typeof normalizeYeastarCdr> extends infer T ? Exclude<T, undefined> : never): Promise<string>;
    upsertSegments(callId: string, segments: YeastarCallSegmentInput[]): Promise<void>;
    updateCallCustomer?(callId: string, match: {
      accountId?: string | null;
      contactId?: string | null;
      contactName?: string | null;
      customerName?: string | null;
    }): Promise<void>;
  };
}) {
  const [events, mappings] = await Promise.all([
    repository.listPendingEvents(),
    repository.listStaffMappings(),
  ]);
  const staffByExtension = new Map(
    mappings.map((mapping) => [mapping.extension, { staffId: mapping.staffId }]),
  );
  let processed = 0;
  let ignored = 0;
  let failed = 0;

  for (const event of events) {
    const uid = event.callId || findCallId(event.payload);
    if (!uid) {
      failed += 1;
      await repository.finishEvent(event.id, "Completed-call event did not include a CDR ID.");
      continue;
    }
    try {
      const normalized = normalizeYeastarCdr(
        await client.getCdrDetail(uid),
        staffByExtension,
      );
      if (!normalized) {
        ignored += 1;
        await repository.finishEvent(event.id);
        continue;
      }
      const callId = await repository.upsertCall(normalized);
      await repository.upsertSegments(callId, normalized.segments);
      if (
        normalized.normalisedExternalNumber &&
        repository.updateCallCustomer
      ) {
        try {
          let match = repository.findPhoneMapping
            ? await repository.findPhoneMapping(normalized.normalisedExternalNumber)
            : undefined;
          if (!match && crmClient) {
            const crmMatch = await matchPhoneToZohoCrm(
              normalized.normalisedExternalNumber,
              crmClient,
            );
            if (crmMatch) {
              match = {
                accountId: crmMatch.accountId ?? null,
                contactId: crmMatch.contactId ?? null,
                contactName: crmMatch.contactName ?? null,
                customerName: crmMatch.customerName ?? null,
              };
              await repository.savePhoneMapping?.({
                accountId: crmMatch.accountId,
                contactId: crmMatch.contactId,
                contactName: crmMatch.contactName,
                customerName: crmMatch.customerName,
                phone: normalized.normalisedExternalNumber,
              });
            }
          }
          if (match) await repository.updateCallCustomer(callId, match);
        } catch (error) {
          console.error("Zoho CRM caller match failed", {
            message: safeMessage(error),
          });
        }
      }

      try {
        const [context, summary] = await Promise.all([
          client.getAiContext(uid),
          client.getAiSummary(uid),
        ]);
        const transcript = extractTranscript(context);
        await repository.updateTranscript({
          actionItems: extractActionItems(summary),
          callId,
          status: transcript ? "complete" : "awaiting_transcript",
          summary: extractSummary(summary),
          transcript,
        });
      } catch (error) {
        await repository.updateTranscript({
          callId,
          error: safeMessage(error),
          status: "awaiting_transcript",
        });
      }
      processed += 1;
      await repository.finishEvent(event.id);
    } catch (error) {
      failed += 1;
      await repository.finishEvent(event.id, safeMessage(error));
    }
  }

  return { discovered: events.length, failed, ignored, processed };
}

export async function reconcileYeastarCalls({
  client,
  from,
  repository,
  to,
}: {
  client: { listCdrs(input: { endTime: string; startTime: string }): Promise<Array<Record<string, unknown>>> };
  from: string;
  repository: { recordEvent(input: {
    callId?: string;
    eventKey: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<boolean> };
  to: string;
}) {
  const calls = await client.listCdrs({ endTime: to, startTime: from });
  let queued = 0;
  for (const payload of calls) {
    const callId = findCallId(payload);
    if (!callId) continue;
    const inserted = await repository.recordEvent({
      callId,
      eventKey: `reconcile:${callId}`,
      eventType: "reconcile",
      payload,
    });
    if (inserted) queued += 1;
  }
  return { discovered: calls.length, queued };
}

function directionFrom(callType: string): YeastarCallDirection {
  const value = callType.toLowerCase();
  if (value.includes("inbound")) return "inbound";
  if (value.includes("outbound")) return "outbound";
  return "unknown";
}

function findCallId(payload: Record<string, unknown>) {
  return (
    text(payload.uid) ||
    text(payload.cdr_id) ||
    text(payload.call_id) ||
    text(payload.new_id)
  );
}

function parsePbxDate(value: string) {
  const match = value.match(
    /^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) return new Date().toISOString();
  const [, year, month, day, hour, minute, second] = match;
  const guess = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}+10:00`,
  );
  return guess.toISOString();
}

function addSeconds(value: string, seconds: number) {
  return new Date(new Date(value).getTime() + seconds * 1000).toISOString();
}

function extractTranscript(payload: Record<string, unknown>) {
  const direct = text(payload.transcript) || text(payload.context);
  if (direct) return direct;
  const entries = array(payload.data ?? payload.list ?? payload.context);
  const lines = entries
    .map(record)
    .map((entry) => {
      const content = text(entry.content) || text(entry.text) || text(entry.sentence);
      const speaker = text(entry.speaker) || text(entry.role);
      return content ? `${speaker ? `${speaker}: ` : ""}${content}` : "";
    })
    .filter(Boolean);
  return lines.join("\n") || undefined;
}

function extractSummary(payload: Record<string, unknown>) {
  return text(payload.summary) || text(record(payload.data).summary) || undefined;
}

function extractActionItems(payload: Record<string, unknown>) {
  const value = payload.action_items ?? record(payload.data).action_items;
  return array(value);
}

function safeMetadata(value: Record<string, unknown>) {
  const copy = structuredClone(value);
  delete copy.recording_url;
  delete copy.download_url;
  delete copy.access_token;
  return copy;
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : "Unknown processing error.";
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function number(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

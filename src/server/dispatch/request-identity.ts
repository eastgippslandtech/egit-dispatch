import type { Appointment, DispatchRequest } from "./types";

const EXPLICIT_REQUEST = /\b(?:CW|REQ|SDP|TICKET|REQUEST)(?:\s+ID)?[-\s#:]*(\d{5,})\b/i;

/** The Request field is distinct from numbers inside a booking ID or supplier title. */
export function structuredRequestReference(body?: string) {
  return body?.match(/(?:^|\r?\n)\s*Request\s*:\s*(?:(?:REQ|SDP|CW)[- #:]*)?(\d+)\b/i)?.[1];
}

export function extractRequestReference(subject?: string, body?: string) {
  return structuredRequestReference(body)
    ?? subject?.match(EXPLICIT_REQUEST)?.[1]
    ?? body?.match(EXPLICIT_REQUEST)?.[1]
    ?? subject?.match(/^\s*(\d{5,})\b/)?.[1];
}

export function normalizeRequestReference(value?: string) {
  const clean = value?.trim();
  if (!clean) return undefined;
  return clean.match(/^(?:(?:CW|REQ|SDP|TICKET|REQUEST)[- #:]*)?(\d+)$/i)?.[1]
    ?? clean.toUpperCase();
}

export function requestIdentityKeys(request: Pick<DispatchRequest, "id" | "requestNumber" | "subject">) {
  const keys = new Set([normalizeRequestReference(request.id), normalizeRequestReference(request.requestNumber)]
    .filter((key): key is string => Boolean(key)));
  // Legacy MSP snapshots sometimes used the internal ID as the display number.
  // A current display number takes precedence over references in ticket content.
  if (normalizeRequestReference(request.id) === normalizeRequestReference(request.requestNumber)) {
    const legacy = extractRequestReference(request.subject);
    if (legacy) keys.add(legacy);
  }
  return keys;
}

export function appointmentRequestReference(appointment: Appointment) {
  if (appointment.outlookIssue === "private") return undefined;
  return structuredRequestReference(appointment.bodyPreview)
    ?? normalizeRequestReference(appointment.requestId)
    ?? normalizeRequestReference(appointment.outlookLinkedRequestNumber)
    ?? extractRequestReference(appointment.title, appointment.bodyPreview);
}

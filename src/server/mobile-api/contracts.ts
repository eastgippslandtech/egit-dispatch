export type MobileApiFailureCode =
  | "BAD_REQUEST"
  | "INTERNAL_ERROR"
  | "NOT_APPROVED"
  | "NOT_FOUND"
  | "READ_ONLY_SOURCE"
  | "UNAUTHORIZED";

export interface MobileApiMeta {
  requestId: string;
  serverTime: string;
}

export interface MobileApiSuccess<TData> {
  data: TData;
  meta: MobileApiMeta;
}

export interface MobileApiFailure {
  error: {
    code: MobileApiFailureCode;
    message: string;
  };
  meta: MobileApiMeta;
}

export interface MobileAuthContext {
  email: string;
  staffId: string;
}

export interface MobileWorklogCommand {
  baseVersion: string;
  billable?: boolean;
  body?: string;
  clientMutationId: string;
  durationMinutes?: number;
  disposition?:
    | "complete"
    | "return_to_queue"
    | "book_forward"
    | "transfer_escalate";
  endedAt?: string;
  followUpNeeded?: boolean;
  forwardBooking?: {
    bookingType: "Remote" | "Onsite" | "In house";
    date: string;
    end: string;
    start: string;
    technicianEmail: string;
    technicianId: string;
    technicianName: string;
  };
  installationId: string;
  occurredAt?: string;
  startedAt?: string;
  summary?: string;
  timerSessionId?: string | null;
  transfer?: {
    reason: string;
    targetEmail: string;
    targetTechnicianId: string;
    targetTechnicianName: string;
  };
  visibility: "external" | "internal";
  workType?: "billable" | "non_billable" | "internal";
}

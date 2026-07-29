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
  endedAt?: string;
  followUpNeeded?: boolean;
  installationId: string;
  occurredAt?: string;
  startedAt?: string;
  summary?: string;
  timerSessionId?: string | null;
  visibility: "external" | "internal";
  workType?: "billable" | "non_billable" | "internal";
}

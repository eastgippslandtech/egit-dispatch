export type YeastarTranscriptStatus =
  | "pending"
  | "metadata_received"
  | "awaiting_transcript"
  | "complete"
  | "failed"
  | "ignored_internal"
  | "ignored_unanswered";

export type YeastarCallDirection = "inbound" | "outbound" | "unknown";

export type YeastarCallSegmentInput = {
  extension: string;
  segmentId: string;
  staffId?: string;
  talkSeconds: number;
  connectedAt?: string;
  disconnectedAt?: string;
  rawMetadata?: Record<string, unknown>;
};

export type YeastarReportableCallInput = {
  answered: boolean;
  callType: string;
  connectedTalkSeconds: number;
  hasExternalParty: boolean;
  hasTrunk: boolean;
};

export type ExternalCallActivity = {
  callId: string;
  customerName?: string;
  direction: YeastarCallDirection;
  endedAt: string;
  externalNumber: string;
  externalTalkSeconds: number;
  id: string;
  startedAt: string;
  technicianId: string;
  transcriptStatus: YeastarTranscriptStatus;
};

export type WeeklyTalkTime = {
  seconds: number;
  technicianId: string;
};

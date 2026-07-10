export type MobileJobSource = "msp_central" | "outlook" | "mock";
export type MobilePriority = "Critical" | "High" | "Medium" | "Low";
export type BookingType = "Remote" | "Onsite" | "In house";
export type MobileJobStatus =
  | "Scheduled"
  | "In Progress"
  | "Waiting on Customer"
  | "Waiting on Parts"
  | "Needs Follow-up"
  | "Completed"
  | "Cancelled / No Access";
export type SyncState = "synced" | "pending" | "failed" | "conflict";
export type NoteVisibility = "internal" | "external";
export type EvidenceKind = "photo" | "document";

export interface DateRange {
  from: string;
  to: string;
}

export interface MobileStaff {
  id: string;
  displayName: string;
  email: string;
  zohoEmail: string;
  outlookEmail: string;
  outlookUserPrincipalName: string;
  mspCentralEmail: string;
  mspCentralTechnicianId: string | null;
  role: "admin" | "technician";
  baseOffice: "Bairnsdale" | "Sale";
  active: boolean;
}

export interface MobileTravelContext {
  mode:
    | "office_to_site_and_back"
    | "previous_job_to_site"
    | "current_area_to_site"
    | "manual_override";
  calculatedFrom:
    | "technician_base_office"
    | "previous_job"
    | "current_area"
    | "manual";
  calculationReason: string;
  baseOfficeName: string | null;
  baseOfficeAddress: string | null;
  travelToSiteMinutes: number;
  travelBackToOfficeMinutes: number;
  estimated: boolean;
}

export interface MobileJobNote {
  id: string;
  localId: string | null;
  visibility: NoteVisibility;
  body: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  syncState: SyncState;
  canEdit: boolean;
  canDelete: boolean;
}

export interface MobilePartUsed {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
  note: string | null;
  syncState: SyncState;
}

export interface MobileJobAttachment {
  id: string;
  localUri: string | null;
  remoteUrl: string | null;
  fileName: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
  category: "photo" | "document" | "signature";
  uploadProgress: number;
  syncState: SyncState;
}

export interface MobileCustomerSignOff {
  id: string;
  customerName: string;
  accepted: true;
  signatureLocalUri: string;
  signedAt: string;
  syncState: SyncState;
}

export interface MobileJobPermissions {
  canWriteWorklog: boolean;
  canStartTimer: boolean;
  canUpdateStatus: boolean;
  canAttachEvidence: boolean;
  canAddPart: boolean;
  canSignOff: boolean;
  canComplete: boolean;
  readOnlyReason: string | null;
}

export interface MobileJob {
  id: string;
  source: MobileJobSource;
  requestNumber: string | null;
  outlookEventId: string | null;
  outlookWebLink: string | null;
  version: string;
  title: string;
  description: string | null;
  priority: MobilePriority | null;
  status: MobileJobStatus;
  bookingType: BookingType;
  startAt: string;
  endAt: string;
  timezone: "Australia/Melbourne";
  isAllDay: boolean;
  slaDueAt: string | null;
  customerName: string | null;
  siteName: string | null;
  siteAddress: string | null;
  siteTown: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  technician: MobileStaff;
  tags: string[];
  travel: MobileTravelContext | null;
  previousNotes: MobileJobNote[];
  parts: MobilePartUsed[];
  attachments: MobileJobAttachment[];
  customerSignOff: MobileCustomerSignOff | null;
  permissions: MobileJobPermissions;
  syncState: SyncState;
  updatedAt: string;
}

export interface ActiveTimer {
  id: string;
  jobId: string;
  technicianId: string;
  startedAt: string;
  pausedAt: string | null;
  accumulatedPausedSeconds: number;
}

export interface StoppedTimer extends ActiveTimer {
  stoppedAt: string;
  actualElapsedMinutes: number;
  roundedMinutes: number;
}

export interface MutationEnvelope {
  clientMutationId: string;
  jobId: string;
  baseVersion: string;
  installationId: string;
  occurredAt: string;
}

export interface MutationReceipt {
  clientMutationId: string;
  mode: "mock";
  resourceId: string;
  resourceVersion: string;
  status: "pending";
  recordedAt: string;
}

export type StartTimerCommand = MutationEnvelope;

export interface StopTimerCommand extends MutationEnvelope {
  timerId: string;
}

export interface SaveWorklogCommand extends MutationEnvelope {
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  summary: string;
  timerSessionId: string | null;
  visibility: NoteVisibility;
}

export interface UpdateStatusCommand extends MutationEnvelope {
  status: MobileJobStatus;
  reason?: string;
}

export interface AttachEvidenceCommand extends MutationEnvelope {
  localUri: string;
  fileName: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
  kind: EvidenceKind;
}

export interface AddPartCommand extends MutationEnvelope {
  name: string;
  sku: string | null;
  quantity: number;
  note: string | null;
}

export interface SaveSignOffCommand extends MutationEnvelope {
  customerName: string;
  accepted: boolean;
  signatureLocalUri: string;
  signedAt: string;
}

export interface CompleteJobCommand extends MutationEnvelope {
  summary: string;
  visibility: NoteVisibility;
  followUpNeeded: boolean;
}

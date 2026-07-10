import type { StaffProfile } from "@/server/staff/profiles";

export type MobileJobStatus =
  | "Scheduled"
  | "In Progress"
  | "Waiting on Customer"
  | "Waiting on Parts"
  | "Needs Follow-up"
  | "Completed"
  | "Cancelled / No Access";

export type MobilePriority = "Critical" | "High" | "Medium" | "Low";
export type MobileWorklogType = "billable" | "internal" | "non_billable";
export type MobileJobMode = "onsite" | "remote" | "workshop" | "internal";
export type MobileEvidenceKind = "photo" | "attachment";
export type MobileMockSyncState = "mock_pending";

export type MobileJobEvidence = {
  id: string;
  jobId: string;
  kind: MobileEvidenceKind;
  fileName: string;
  fileSizeBytes?: number;
  note?: string;
  capturedAt: string;
  uploadState: MobileMockSyncState;
};

export type MobileCustomerSignOff = {
  id: string;
  jobId: string;
  accepted: boolean;
  customerName: string;
  signatureText?: string;
  signedAt: string;
  syncState: MobileMockSyncState;
};

export type MobilePartUsed = {
  id: string;
  jobId: string;
  partName: string;
  quantity: number;
  sku?: string;
  syncState: MobileMockSyncState;
};

export type MobileJob = {
  id: string;
  appointmentId: string;
  requestId?: string;
  requestNumber?: string;
  title: string;
  description: string;
  customer: string;
  site: string;
  address?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  priority: MobilePriority;
  status: MobileJobStatus;
  slaDueAt?: string;
  scheduledDate: string;
  scheduledStart: string;
  scheduledEnd: string;
  technicianId: string;
  technicianName: string;
  jobMode: MobileJobMode;
  travelIndicator?: string;
  readOnlyOutlook: boolean;
  outlookEventId?: string;
  outlookWebLink?: string;
  linkedMspCentralRequest: string;
  previousNotes: string[];
  travelInformation: string;
  evidence: MobileJobEvidence[];
  customerSignOff?: MobileCustomerSignOff;
  partsUsed: MobilePartUsed[];
};

export type MobileJobActions = {
  canAddWorkNote: boolean;
  canAttachEvidence: boolean;
  canCallContact: boolean;
  canCaptureCustomerSignOff: boolean;
  canChangeStatus: boolean;
  canComplete: boolean;
  canEmailContact: boolean;
  canOpenMaps: boolean;
  canOpenOutlookEvent: boolean;
  canReassign: boolean;
  canStartTimer: boolean;
  canTrackParts: boolean;
};

export type MobileWorkloadSection = {
  id:
    | "today"
    | "upcoming"
    | "assigned"
    | "sla-risk"
    | "waiting-on-me"
    | "recently-completed";
  label: string;
  jobs: MobileJob[];
};

export type ActiveMobileTimer = {
  id: string;
  technicianId: string;
  jobId: string;
  startedAt: string;
};

export type StoppedMobileTimer = ActiveMobileTimer & {
  stoppedAt: string;
  actualElapsedMinutes: number;
  roundedMinutes: number;
};

export type WorkNoteDraft = {
  jobId: string;
  noteText: string;
  optionalMinutes?: number;
  optionalStatus?: MobileJobStatus;
  simulateFailure?: boolean;
  worklogType: MobileWorklogType;
};

export type DraftSaveResult =
  | {
      saved: true;
      draft: WorkNoteDraft;
    }
  | {
      saved: false;
      draft: WorkNoteDraft;
      error: string;
    };

export type MobilePageData = {
  initialDate: string;
  jobs: MobileJob[];
  signedInStaff: StaffProfile;
  workload: MobileWorkloadSection[];
  assignableTechnicians: StaffProfile[];
};

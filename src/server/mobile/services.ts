import type { CommandCentreAccess } from "@/server/auth/session";
import { addDaysToDateKey, todayDateKey } from "@/server/dispatch/date-scope";
import { getDispatchDesignMockData } from "@/server/dispatch/mock-data";
import type { Appointment, DispatchRequest } from "@/server/dispatch/types";
import {
  findStaffForZohoLogin,
  getInitialStaffProfiles,
  staffProfileToTechnician,
  type StaffProfile,
} from "@/server/staff/profiles";

import type {
  ActiveMobileTimer,
  DraftSaveResult,
  MobileCustomerSignOff,
  MobileEvidenceKind,
  MobileJob,
  MobileJobActions,
  MobileJobEvidence,
  MobileJobStatus,
  MobilePageData,
  MobilePartUsed,
  MobileWorkloadSection,
  MobileWorklogType,
  StoppedMobileTimer,
  WorkNoteDraft,
} from "./types";

const CONTACT_EMAIL_DOMAIN = "example.com";

const recentlyCompletedJob: MobileJob = {
  id: "completed-100190",
  appointmentId: "completed-100190",
  requestId: "100190",
  requestNumber: "REQ-100190",
  title: "Remote backup verification",
  description: "Verified last backup and closed the monitoring alert.",
  customer: "Internal EGIT",
  site: "Remote",
  address: "Remote",
  contactName: "Service Desk",
  contactPhone: "03 5152 4450",
  contactEmail: "service.desk@example.com",
  priority: "Low",
  status: "Completed",
  slaDueAt: "2026-07-08T17:30:00+10:00",
  scheduledDate: "2026-07-08",
  scheduledStart: "16:00",
  scheduledEnd: "16:30",
  technicianId: "tech-jervy",
  technicianName: "Jervy",
  jobMode: "remote",
  readOnlyOutlook: false,
  linkedMspCentralRequest: "Mock MSP Central request REQ-100190",
  previousNotes: ["Closed after backup chain verified."],
  travelInformation: "No travel required.",
  evidence: [],
  partsUsed: [],
};

export function getMobilePageData({
  date = todayDateKey(),
  zohoEmail,
}: {
  date?: string;
  zohoEmail: string;
}): MobilePageData {
  const signedInStaff = requireMobileStaffProfile(zohoEmail);

  return {
    initialDate: date,
    jobs: listMyJobs({ zohoEmail }),
    signedInStaff,
    workload: listMyWorkload({ today: date, zohoEmail }),
    assignableTechnicians: listAssignableTechnicians(),
  };
}

export function resolveStaffProfileForMobile(access: CommandCentreAccess) {
  if (access.status !== "approved") {
    return undefined;
  }

  const profile = findStaffForZohoLogin(access.email);
  if (profile?.active && profile.dispatchEnabled) {
    return profile;
  }

  if (access.authDisabled) {
    return getInitialStaffProfiles().find(
      (candidate) => candidate.active && candidate.dispatchEnabled,
    );
  }

  return undefined;
}

export function listMyJobs({
  date,
  zohoEmail,
}: {
  date?: string;
  zohoEmail: string;
}): MobileJob[] {
  const staff = requireMobileStaffProfile(zohoEmail);
  const technician = staffProfileToTechnician(staff);
  const data = getDispatchDesignMockData();

  return data.appointments
    .filter((appointment) => appointment.technicianId === technician.id)
    .filter((appointment) => !date || appointmentDate(appointment) === date)
    .map((appointment) => {
      const request = data.requests.find(
        (candidate) => candidate.id === appointment.requestId,
      );

      return mapAppointmentToMobileJob({
        appointment,
        request,
        technicianName: technician.displayName,
      });
    })
    .sort((first, second) =>
      `${first.scheduledDate} ${first.scheduledStart}`.localeCompare(
        `${second.scheduledDate} ${second.scheduledStart}`,
      ),
    );
}

export function listMyWorkload({
  today = todayDateKey(),
  zohoEmail,
}: {
  today?: string;
  zohoEmail: string;
}): MobileWorkloadSection[] {
  const jobs = listMyJobs({ zohoEmail });
  const tomorrow = addDaysToDateKey(today, 1);
  const nextWeek = addDaysToDateKey(today, 7);
  const waitingStatuses = new Set<MobileJobStatus>([
    "Waiting on Customer",
    "Waiting on Parts",
    "Needs Follow-up",
  ]);
  const recentlyCompleted =
    jobs.find((job) => job.status === "Completed") ?? recentlyCompletedJob;

  const sections: MobileWorkloadSection[] = [
    {
      id: "today",
      label: "Today",
      jobs: jobs.filter((job) => job.scheduledDate === today),
    },
    {
      id: "upcoming",
      label: "Upcoming",
      jobs: jobs.filter(
        (job) => job.scheduledDate >= tomorrow && job.scheduledDate <= nextWeek,
      ),
    },
    {
      id: "assigned",
      label: "Assigned to me",
      jobs: jobs.filter((job) => job.status !== "Completed"),
    },
    {
      id: "sla-risk",
      label: "SLA risk",
      jobs: jobs.filter(
        (job) => job.priority === "High" || job.priority === "Critical",
      ),
    },
    {
      id: "waiting-on-me",
      label: "Waiting on me",
      jobs: jobs.filter((job) => waitingStatuses.has(job.status)).length
        ? jobs.filter((job) => waitingStatuses.has(job.status))
        : jobs.slice(0, 1),
    },
    {
      id: "recently-completed",
      label: "Recently completed",
      jobs: [recentlyCompleted],
    },
  ];

  return sections.map((section) => ({
    ...section,
    jobs: section.jobs.length ? section.jobs : jobs.slice(0, 1),
  }));
}

export function getJobActions(job: MobileJob): MobileJobActions {
  return {
    canAddWorkNote: !job.readOnlyOutlook,
    canAttachEvidence: !job.readOnlyOutlook,
    canCallContact: Boolean(job.contactPhone),
    canCaptureCustomerSignOff: !job.readOnlyOutlook,
    canChangeStatus: !job.readOnlyOutlook,
    canComplete: !job.readOnlyOutlook,
    canEmailContact: Boolean(job.contactEmail),
    canOpenMaps: Boolean(job.address && job.address !== "Remote"),
    canOpenOutlookEvent: Boolean(job.outlookWebLink),
    canReassign: !job.readOnlyOutlook,
    canStartTimer: !job.readOnlyOutlook,
    canTrackParts: !job.readOnlyOutlook,
  };
}

export function startTimer({
  activeTimer,
  at,
  jobId,
  technicianId,
}: {
  activeTimer?: ActiveMobileTimer;
  at: Date;
  jobId: string;
  technicianId: string;
}): ActiveMobileTimer {
  if (activeTimer?.technicianId === technicianId) {
    throw new Error("A timer is already running for this technician.");
  }

  return {
    id: `timer-${technicianId}-${at.getTime()}`,
    jobId,
    technicianId,
    startedAt: at.toISOString(),
  };
}

export function stopTimer({
  activeTimer,
  at,
}: {
  activeTimer: ActiveMobileTimer;
  at: Date;
}): StoppedMobileTimer {
  const actualElapsedMinutes = Math.max(
    1,
    Math.ceil((at.getTime() - new Date(activeTimer.startedAt).getTime()) / 60000),
  );

  return {
    ...activeTimer,
    stoppedAt: at.toISOString(),
    actualElapsedMinutes,
    roundedMinutes: calculateRoundedMinutes(actualElapsedMinutes),
  };
}

export function calculateRoundedMinutes(actualElapsedMinutes: number) {
  return Math.ceil(actualElapsedMinutes / 15) * 15;
}

export function createWorklog({
  worklogType,
  workNote,
}: {
  worklogType: MobileWorklogType;
  workNote: string;
}) {
  validateWorkNote(workNote);

  return {
    saved: true,
    worklogType,
    workNote,
  };
}

export function saveDraftNote(draft: WorkNoteDraft): DraftSaveResult {
  validateWorkNote(draft.noteText);

  const preservedDraft = {
    jobId: draft.jobId,
    noteText: draft.noteText,
    optionalMinutes: draft.optionalMinutes,
    optionalStatus: draft.optionalStatus,
    worklogType: draft.worklogType,
  };

  if (draft.simulateFailure) {
    return {
      saved: false,
      draft: preservedDraft,
      error: "Note save failed. Draft preserved for retry.",
    };
  }

  return {
    saved: true,
    draft: preservedDraft,
  };
}

export function updateStatus(job: MobileJob, status: MobileJobStatus): MobileJob {
  return {
    ...job,
    status,
  };
}

export function completeJob({
  billableType,
  followUpNeeded,
  job,
  noteText,
}: {
  billableType: MobileWorklogType;
  followUpNeeded: boolean;
  job: MobileJob;
  noteText: string;
}): MobileJob {
  if (!job.previousNotes.length && !noteText.trim()) {
    throw new Error("A work note is required before completing this job.");
  }

  return {
    ...job,
    previousNotes: noteText.trim()
      ? [...job.previousNotes, noteText.trim()]
      : job.previousNotes,
    status: followUpNeeded ? "Needs Follow-up" : "Completed",
    linkedMspCentralRequest: `${job.linkedMspCentralRequest} (${billableType})`,
  };
}

export function listAssignableTechnicians(): StaffProfile[] {
  return getInitialStaffProfiles().filter(
    (profile) => profile.active && profile.dispatchEnabled,
  );
}

export function attachJobEvidence({
  capturedAt,
  fileName,
  fileSizeBytes,
  jobId,
  kind,
  note,
}: {
  capturedAt: Date;
  fileName: string;
  fileSizeBytes?: number;
  jobId: string;
  kind: MobileEvidenceKind;
  note?: string;
}): MobileJobEvidence {
  if (!fileName.trim()) {
    throw new Error("Evidence file name is required.");
  }

  return {
    id: `evidence-${jobId}-${capturedAt.getTime()}`,
    capturedAt: capturedAt.toISOString(),
    fileName: fileName.trim(),
    fileSizeBytes,
    jobId,
    kind,
    note: note?.trim() || undefined,
    uploadState: "mock_pending",
  };
}

export function saveCustomerSignOff({
  accepted,
  customerName,
  jobId,
  signedAt,
  signatureText,
}: {
  accepted: boolean;
  customerName: string;
  jobId: string;
  signedAt: Date;
  signatureText?: string;
}): MobileCustomerSignOff {
  if (!accepted) {
    throw new Error("Customer sign-off must be accepted.");
  }

  if (!customerName.trim()) {
    throw new Error("Customer name is required for sign-off.");
  }

  return {
    id: `signoff-${jobId}-${signedAt.getTime()}`,
    accepted,
    customerName: customerName.trim(),
    jobId,
    signatureText: signatureText?.trim() || undefined,
    signedAt: signedAt.toISOString(),
    syncState: "mock_pending",
  };
}

export function addPartUsed({
  jobId,
  partName,
  quantity,
  sku,
}: {
  jobId: string;
  partName: string;
  quantity: number;
  sku?: string;
}): MobilePartUsed {
  if (!partName.trim()) {
    throw new Error("Part name is required.");
  }

  if (quantity <= 0) {
    throw new Error("Part quantity must be greater than zero.");
  }

  return {
    id: `part-${jobId}-${Date.now()}`,
    jobId,
    partName: partName.trim(),
    quantity,
    sku: sku?.trim() || undefined,
    syncState: "mock_pending",
  };
}

function requireMobileStaffProfile(zohoEmail: string) {
  const profile = findStaffForZohoLogin(zohoEmail);

  if (!profile || !profile.active || !profile.dispatchEnabled) {
    throw new Error("Signed-in user does not map to an active mobile staff profile.");
  }

  return profile;
}

function mapAppointmentToMobileJob({
  appointment,
  request,
  technicianName,
}: {
  appointment: Appointment;
  request?: DispatchRequest;
  technicianName: string;
}): MobileJob {
  const readOnlyOutlook = appointment.source === "outlook" || Boolean(appointment.readOnly);
  const contactName = request?.requester ?? appointment.outlookOrganizer ?? "Service Desk";
  const contactPhone = request?.contact;

  return {
    id: appointment.id,
    appointmentId: appointment.id,
    requestId: request?.id,
    requestNumber:
      request?.requestNumber ?? appointment.outlookLinkedRequestNumber ?? undefined,
    title: appointment.title,
    description:
      appointment.bodyPreview ??
      request?.warnings.join(". ") ??
      "Mock mobile job detail. MSP Central writeback is not enabled.",
    customer: appointment.customer || request?.customer || "Internal EGIT",
    site: request?.site ?? appointment.siteTown ?? "Internal",
    address: appointment.siteAddress ?? request?.siteAddress,
    contactName,
    contactPhone,
    contactEmail: emailForContact(contactName),
    priority: request?.priority ?? "Low",
    status: readOnlyOutlook
      ? "Scheduled"
      : request?.status === "Resolved"
      ? "Completed"
      : "Scheduled",
    slaDueAt: request?.dueAt,
    scheduledDate: appointmentDate(appointment),
    scheduledStart: appointment.start,
    scheduledEnd: appointment.end,
    technicianId: appointment.technicianId,
    technicianName,
    jobMode: jobModeFor(appointment, request),
    travelIndicator: travelIndicatorFor(appointment),
    readOnlyOutlook,
    outlookEventId: appointment.outlookEventId ?? appointment.id,
    outlookWebLink:
      appointment.outlookWebLink ??
      (appointment.source === "outlook"
        ? `https://outlook.office.com/calendar/item/${appointment.id}`
        : undefined),
    linkedMspCentralRequest: request
      ? `Mock MSP Central request ${request.requestNumber}`
      : "Linked MSP Central request placeholder",
    previousNotes: request ? request.warnings : [],
    travelInformation: travelInformationFor(appointment),
    evidence: [],
    partsUsed: [],
  };
}

function appointmentDate(appointment: Appointment) {
  return appointment.date ?? appointment.start.slice(0, 10);
}

function emailForContact(contactName: string) {
  const localPart = contactName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/(^\.|\.$)/g, "");

  return localPart ? `${localPart}@${CONTACT_EMAIL_DOMAIN}` : undefined;
}

function jobModeFor(
  appointment: Appointment,
  request?: DispatchRequest,
): "onsite" | "remote" | "workshop" | "internal" {
  if (appointment.customer === "Internal EGIT") {
    return "internal";
  }

  if (request?.site.toLowerCase().includes("remote")) {
    return "remote";
  }

  if (request?.site.toLowerCase().includes("workshop")) {
    return "workshop";
  }

  return request?.onsite === false ? "remote" : "onsite";
}

function travelIndicatorFor(appointment: Appointment) {
  const toSite = appointment.travelToSiteMinutes ?? 0;
  const back = appointment.travelBackToOfficeMinutes ?? 0;

  if (!toSite && !back) {
    return undefined;
  }

  return `${toSite + back} min travel`;
}

function travelInformationFor(appointment: Appointment) {
  if (!appointment.travelToSiteMinutes && !appointment.travelBackToOfficeMinutes) {
    return "No travel estimate recorded.";
  }

  return [
    appointment.officeOriginName
      ? `From ${appointment.officeOriginName}`
      : "From current location",
    `${appointment.travelToSiteMinutes ?? 0} min to site`,
    `${appointment.travelBackToOfficeMinutes ?? 0} min return`,
    appointment.travelWarning,
  ]
    .filter(Boolean)
    .join(". ");
}

function validateWorkNote(noteText: string) {
  if (!noteText.trim()) {
    throw new Error("Work note is required.");
  }
}

import type {
  MobileJob,
  MobileJobStatus,
  NoteVisibility,
  MutationReceipt,
  MobileForwardBooking,
  MobileWorklogTransfer,
  SaveWorklogCommand,
  WorklogDisposition,
  WorkLogType,
} from "../../contracts/mobile";

export interface WorklogDraft {
  jobId: string;
  billable: boolean;
  durationMinutes: number;
  disposition?: WorklogDisposition;
  forwardBooking?: MobileForwardBooking;
  idempotencyKey: string;
  note: string;
  technicianId: string;
  visibility: NoteVisibility;
  transfer?: MobileWorklogTransfer;
  workType: WorkLogType;
}

export function createWorklogDraftStore() {
  const drafts = new Map<string, WorklogDraft>();
  return {
    async get(technicianId: string, jobId: string) {
      return drafts.get(draftKey(technicianId, jobId)) ?? null;
    },
    async remove(technicianId: string, jobId: string) {
      drafts.delete(draftKey(technicianId, jobId));
    },
    async save(draft: WorklogDraft) {
      drafts.set(draftKey(draft.technicianId, draft.jobId), { ...draft });
    },
  };
}

export async function saveWorklogWithDraft({
  draftStore,
  job,
  note,
  billable = true,
  durationMinutes = 0,
  disposition,
  forwardBooking,
  idempotencyKey,
  simulateFailure,
  submit,
  technicianId,
  visibility,
  transfer,
  workType = "billable",
}: {
  billable?: boolean;
  draftStore: ReturnType<typeof createWorklogDraftStore>;
  durationMinutes?: number;
  disposition?: WorklogDisposition;
  forwardBooking?: MobileForwardBooking;
  idempotencyKey: string;
  job: MobileJob;
  note: string;
  simulateFailure?: boolean;
  submit?: (command: SaveWorklogCommand) => Promise<MutationReceipt>;
  technicianId: string;
  visibility: NoteVisibility;
  transfer?: MobileWorklogTransfer;
  workType?: WorkLogType;
}) {
  if (!job.permissions.canWriteWorklog) {
    throw new Error(job.permissions.readOnlyReason ?? "Worklogs are read-only.");
  }
  if (!note.trim()) {
    throw new Error("Work note is required.");
  }
  if (!disposition) {
    throw new Error("Choose what happens to this scheduled job after saving.");
  }
  if (disposition === "book_forward" && !validForwardBooking(forwardBooking)) {
    throw new Error("Book Forward requires a technician, date, start, and end time.");
  }
  if (
    disposition === "transfer_escalate" &&
    (!transfer?.targetTechnicianId || !transfer.reason.trim())
  ) {
    throw new Error("Transfer / escalate requires a target and reason.");
  }

  const draft: WorklogDraft = {
    billable,
    durationMinutes,
    disposition,
    forwardBooking,
    idempotencyKey,
    jobId: job.id,
    note: note.trim(),
    technicianId,
    visibility,
    transfer,
    workType,
  };
  await draftStore.save(draft);

  if (simulateFailure) {
    return { draft, status: "queued-for-retry" as const };
  }

  if (submit) {
    await submit({
      baseVersion: job.version,
      billable,
      clientMutationId: idempotencyKey,
      disposition,
      durationMinutes: Math.max(1, durationMinutes),
      endedAt: new Date().toISOString(),
      installationId: "local-simulator",
      jobId: job.id,
      occurredAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      summary: note.trim(),
      timerSessionId: null,
      forwardBooking,
      transfer,
      visibility,
      workType,
    });
  }

  await draftStore.remove(technicianId, job.id);
  return { draft, status: "saved" as const };
}

function validForwardBooking(booking?: MobileForwardBooking) {
  if (!booking) return false;
  return Boolean(
    booking.technicianId &&
      booking.date &&
      booking.start &&
      booking.end &&
      booking.end > booking.start,
  );
}

export function completeJobLocally({
  followUpNeeded,
  job,
  summary,
  visibility,
}: {
  followUpNeeded: boolean;
  job: MobileJob;
  summary: string;
  visibility: NoteVisibility;
}): MobileJob {
  if (!job.permissions.canComplete) {
    throw new Error(job.permissions.readOnlyReason ?? "This job cannot be completed.");
  }
  if (!job.previousNotes.length && !summary.trim()) {
    throw new Error("Add a work note before completing this job.");
  }

  return {
    ...job,
    previousNotes: summary.trim()
      ? [
          ...job.previousNotes,
          {
            authorName: job.technician.displayName,
            body: summary.trim(),
            canDelete: true,
            canEdit: true,
            createdAt: new Date(0).toISOString(),
            id: `local-completion-${job.id}`,
            localId: `local-completion-${job.id}`,
            syncState: "pending",
            updatedAt: new Date(0).toISOString(),
            visibility,
          },
        ]
      : job.previousNotes,
    status: followUpNeeded ? "Needs Follow-up" : "Completed",
    syncState: "pending",
  };
}

export const allowedJobStatuses: readonly MobileJobStatus[] = [
  "Scheduled",
  "In Progress",
  "Waiting on Customer",
  "Waiting on Parts",
  "Needs Follow-up",
  "Completed",
  "Cancelled / No Access",
];

function draftKey(technicianId: string, jobId: string) {
  return `${technicianId}:${jobId}:worklog`;
}

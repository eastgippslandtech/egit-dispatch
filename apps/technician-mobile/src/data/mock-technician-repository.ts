import type {
  ActiveTimer,
  AddPartCommand,
  AttachEvidenceCommand,
  CompleteJobCommand,
  DateRange,
  MobileJob,
  MobileStaff,
  MutationEnvelope,
  MutationReceipt,
  SaveSignOffCommand,
  SaveWorklogCommand,
  StartTimerCommand,
  StoppedTimer,
  StopTimerCommand,
  UpdateStatusCommand,
} from "../contracts/mobile";
import {
  cloneMobileFixture,
  MOBILE_JOB_FIXTURES,
  MOBILE_STAFF_FIXTURES,
} from "../testing/fixtures";

import type { TechnicianRepository } from "./technician-repository";

interface MockTechnicianRepositoryOptions {
  jobs?: readonly MobileJob[];
  staffEmail: string;
}

export class MockTechnicianRepository implements TechnicianRepository {
  private readonly jobs: MobileJob[];
  private readonly staff: MobileStaff | undefined;
  private activeTimer: ActiveTimer | null = null;
  private readonly receipts = new Map<string, MutationReceipt>();
  private readonly mutationSignatures = new Map<string, string>();
  private readonly timerResults = new Map<
    string,
    ActiveTimer | StoppedTimer
  >();

  constructor({
    jobs = MOBILE_JOB_FIXTURES,
    staffEmail,
  }: MockTechnicianRepositoryOptions) {
    this.jobs = jobs.map(cloneMobileFixture);
    const normalizedEmail = staffEmail.trim().toLowerCase();
    const staff = MOBILE_STAFF_FIXTURES.find(
      (candidate) => candidate.email.toLowerCase() === normalizedEmail,
    );
    this.staff = staff ? cloneMobileFixture(staff) : undefined;
  }

  async getCurrentStaff(): Promise<MobileStaff> {
    return cloneMobileFixture(this.requireStaff());
  }

  async listSchedule(range: DateRange): Promise<MobileJob[]> {
    validateRange(range);
    const staff = this.requireStaff();

    return this.jobs
      .filter((job) => job.technician.id === staff.id)
      .filter((job) => {
        const date = job.startAt.slice(0, 10);
        return date >= range.from && date <= range.to;
      })
      .sort((left, right) => left.startAt.localeCompare(right.startAt))
      .map(cloneMobileFixture);
  }

  async getJob(jobId: string): Promise<MobileJob> {
    return cloneMobileFixture(this.requireOwnedJob(jobId));
  }

  async startTimer(command: StartTimerCommand): Promise<ActiveTimer> {
    const replay = this.replayedTimer<ActiveTimer>("timer-start", command);
    if (replay) return replay;

    const job = this.requireWritableCommand(command);
    if (!job.permissions.canStartTimer) {
      throw new Error("A timer cannot be started for this job.");
    }
    if (this.activeTimer) {
      throw new Error("A timer is already running for this technician.");
    }

    requireTimestamp(command.occurredAt, "Timer start time");
    this.activeTimer = {
      id: `timer-${command.clientMutationId}`,
      jobId: command.jobId,
      technicianId: this.requireStaff().id,
      startedAt: command.occurredAt,
      pausedAt: null,
      accumulatedPausedSeconds: 0,
    };

    return this.recordTimer("timer-start", command, this.activeTimer);
  }

  async stopTimer(command: StopTimerCommand): Promise<StoppedTimer> {
    const replay = this.replayedTimer<StoppedTimer>("timer-stop", command);
    if (replay) return replay;

    this.requireWritableCommand(command);
    const timer =
      this.activeTimer ?? this.restoredTimerFromStopCommand(command);
    if (
      !timer ||
      timer.id !== command.timerId ||
      timer.jobId !== command.jobId
    ) {
      throw new Error("The active timer does not match this stop command.");
    }

    const stoppedAt = requireTimestamp(command.occurredAt, "Timer stop time");
    const startedAt = requireTimestamp(timer.startedAt, "Timer start time");
    if (stoppedAt < startedAt) {
      throw new Error("Timer stop time cannot be before its start time.");
    }

    const elapsedMilliseconds = stoppedAt - startedAt;
    const actualElapsedMinutes = Math.max(
      1,
      Math.ceil(elapsedMilliseconds / 60_000),
    );
    const stopped: StoppedTimer = {
      ...timer,
      stoppedAt: command.occurredAt,
      actualElapsedMinutes,
      roundedMinutes: Math.ceil(actualElapsedMinutes / 15) * 15,
    };
    this.activeTimer = null;

    return this.recordTimer("timer-stop", command, stopped);
  }

  private restoredTimerFromStopCommand(
    command: StopTimerCommand,
  ): ActiveTimer | null {
    if (!command.startedAt) {
      return null;
    }

    requireTimestamp(command.startedAt, "Timer start time");
    return {
      accumulatedPausedSeconds: 0,
      id: command.timerId,
      jobId: command.jobId,
      pausedAt: null,
      startedAt: command.startedAt,
      technicianId: this.requireStaff().id,
    };
  }

  async saveWorklog(command: SaveWorklogCommand): Promise<MutationReceipt> {
    const replay = this.replayedReceipt("worklog", command);
    if (replay) return replay;

    const job = this.requireWritableCommand(command);
    if (!job.permissions.canWriteWorklog) {
      throw new Error("Worklogs cannot be added to this job.");
    }
    if (!command.summary.trim()) {
      throw new Error("Worklog summary is required.");
    }
    if (command.durationMinutes <= 0) {
      throw new Error("Worklog duration must be greater than zero.");
    }

    job.previousNotes.push({
      id: `mock-worklog-${command.clientMutationId}`,
      localId: command.clientMutationId,
      kind: "worklog",
      visibility: command.visibility,
      body: command.summary.trim(),
      authorName: this.requireStaff().displayName,
      createdAt: command.occurredAt,
      updatedAt: command.occurredAt,
      durationMinutes: command.durationMinutes,
      isBillable:
        command.workType === "billable" || command.billable === true,
      syncState: "pending",
      canEdit: true,
      canDelete: true,
    });
    return this.recordMutation("worklog", command, job);
  }

  async updateStatus(command: UpdateStatusCommand): Promise<MutationReceipt> {
    const replay = this.replayedReceipt("status", command);
    if (replay) return replay;

    const job = this.requireWritableCommand(command);
    if (!job.permissions.canUpdateStatus) {
      throw new Error("Status cannot be changed for this job.");
    }
    job.status = command.status;
    return this.recordMutation("status", command, job);
  }

  async attachEvidence(
    command: AttachEvidenceCommand,
  ): Promise<MutationReceipt> {
    const replay = this.replayedReceipt("evidence", command);
    if (replay) return replay;

    const job = this.requireWritableCommand(command);
    if (!job.permissions.canAttachEvidence) {
      throw new Error("Evidence cannot be attached to this job.");
    }
    if (!command.fileName.trim() || !command.localUri.trim()) {
      throw new Error("Evidence file name and local URI are required.");
    }

    job.attachments.push({
      id: `mock-evidence-${command.clientMutationId}`,
      localUri: command.localUri,
      remoteUrl: null,
      fileName: command.fileName.trim(),
      mimeType: command.mimeType,
      byteLength: command.byteLength,
      sha256: command.sha256,
      category: command.kind,
      uploadProgress: 0,
      syncState: "pending",
    });
    return this.recordMutation("evidence", command, job);
  }

  async addPart(command: AddPartCommand): Promise<MutationReceipt> {
    const replay = this.replayedReceipt("part", command);
    if (replay) return replay;

    const job = this.requireWritableCommand(command);
    if (!job.permissions.canAddPart) {
      throw new Error("Parts cannot be added to this job.");
    }
    if (!command.name.trim()) {
      throw new Error("Part name is required.");
    }
    if (command.quantity < 1) {
      throw new Error("Part quantity must be at least 1.");
    }

    job.parts.push({
      id: `mock-part-${command.clientMutationId}`,
      name: command.name.trim(),
      sku: command.sku?.trim() || null,
      quantity: command.quantity,
      note: command.note?.trim() || null,
      syncState: "pending",
    });
    return this.recordMutation("part", command, job);
  }

  async saveSignOff(command: SaveSignOffCommand): Promise<MutationReceipt> {
    const replay = this.replayedReceipt("signoff", command);
    if (replay) return replay;

    const job = this.requireWritableCommand(command);
    if (!job.permissions.canSignOff) {
      throw new Error("Customer sign-off cannot be saved for this job.");
    }
    if (
      !command.accepted ||
      !command.customerName.trim() ||
      !command.signatureLocalUri.trim()
    ) {
      throw new Error("Customer acceptance and signature are required.");
    }

    job.customerSignOff = {
      id: `mock-signoff-${command.clientMutationId}`,
      customerName: command.customerName.trim(),
      accepted: true,
      signatureLocalUri: command.signatureLocalUri,
      signedAt: command.signedAt,
      syncState: "pending",
    };
    return this.recordMutation("signoff", command, job);
  }

  async completeJob(command: CompleteJobCommand): Promise<MutationReceipt> {
    const replay = this.replayedReceipt("completion", command);
    if (replay) return replay;

    const job = this.requireWritableCommand(command);
    if (!job.permissions.canComplete) {
      throw new Error("This job cannot be completed.");
    }
    if (!job.previousNotes.length && !command.summary.trim()) {
      throw new Error("Add a work note before completing this job.");
    }
    if (command.summary.trim()) {
      job.previousNotes.push({
        id: `mock-completion-note-${command.clientMutationId}`,
        localId: command.clientMutationId,
        kind:
          command.visibility === "external"
            ? "customer_reply"
            : "internal_note",
        visibility: command.visibility,
        body: command.summary.trim(),
        authorName: this.requireStaff().displayName,
        createdAt: command.occurredAt,
        updatedAt: command.occurredAt,
        durationMinutes: null,
        isBillable: null,
        syncState: "pending",
        canEdit: true,
        canDelete: true,
      });
    }
    job.status = command.followUpNeeded ? "Needs Follow-up" : "Completed";
    return this.recordMutation("completion", command, job);
  }

  private requireStaff(): MobileStaff {
    if (!this.staff?.active) {
      throw new Error(
        "Signed-in user does not map to an active technician fixture.",
      );
    }
    return this.staff;
  }

  private requireOwnedJob(jobId: string): MobileJob {
    const job = this.jobs.find((candidate) => candidate.id === jobId);
    if (!job) {
      throw new Error("Job was not found.");
    }
    if (job.technician.id !== this.requireStaff().id) {
      throw new Error("Job is not assigned to the signed-in technician.");
    }
    return job;
  }

  private requireWritableJob(jobId: string): MobileJob {
    const job = this.requireOwnedJob(jobId);
    if (job.source === "outlook" || job.permissions.readOnlyReason) {
      throw new Error("This Outlook event is read-only.");
    }
    return job;
  }

  private requireWritableCommand(command: MutationEnvelope): MobileJob {
    const job = this.requireWritableJob(command.jobId);
    if (job.version !== command.baseVersion) {
      throw new Error("Job version conflict.");
    }
    return job;
  }

  private replayedReceipt(resource: string, command: MutationEnvelope) {
    const expectedSignature = this.mutationSignatures.get(
      command.clientMutationId,
    );
    if (!expectedSignature) return undefined;
    if (expectedSignature !== mutationSignature(resource, command)) {
      throw new Error("Idempotency key was reused for a different mutation.");
    }
    const receipt = this.receipts.get(command.clientMutationId);
    if (!receipt) {
      throw new Error("Idempotency key was reused for a different mutation.");
    }
    return cloneMobileFixture(receipt);
  }

  private replayedTimer<T extends ActiveTimer | StoppedTimer>(
    resource: string,
    command: MutationEnvelope,
  ): T | undefined {
    const expectedSignature = this.mutationSignatures.get(
      command.clientMutationId,
    );
    if (!expectedSignature) return undefined;
    if (expectedSignature !== mutationSignature(resource, command)) {
      throw new Error("Idempotency key was reused for a different mutation.");
    }
    const result = this.timerResults.get(command.clientMutationId);
    if (!result) {
      throw new Error("Idempotency key was reused for a different mutation.");
    }
    return cloneMobileFixture(result) as T;
  }

  private recordTimer<T extends ActiveTimer | StoppedTimer>(
    resource: string,
    command: MutationEnvelope,
    result: T,
  ): T {
    this.mutationSignatures.set(
      command.clientMutationId,
      mutationSignature(resource, command),
    );
    this.timerResults.set(command.clientMutationId, cloneMobileFixture(result));
    return cloneMobileFixture(result);
  }

  private recordMutation(
    resource: string,
    command: MutationEnvelope,
    job: MobileJob,
  ): MutationReceipt {
    const receipt: MutationReceipt = {
      clientMutationId: command.clientMutationId,
      mode: "mock",
      resourceId: `mock-${resource}-${command.clientMutationId}`,
      resourceVersion: `mock-version-${command.clientMutationId}`,
      status: "pending",
      recordedAt: command.occurredAt,
    };
    job.version = receipt.resourceVersion;
    job.syncState = "pending";
    job.updatedAt = command.occurredAt;
    this.receipts.set(command.clientMutationId, receipt);
    this.mutationSignatures.set(
      command.clientMutationId,
      mutationSignature(resource, command),
    );
    return cloneMobileFixture(receipt);
  }
}

function validateRange(range: DateRange) {
  const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;
  if (
    !dateKeyPattern.test(range.from) ||
    !dateKeyPattern.test(range.to) ||
    range.from > range.to
  ) {
    throw new Error("Schedule range must use ordered YYYY-MM-DD dates.");
  }
}

function requireTimestamp(value: string, label: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return timestamp;
}

function mutationSignature(resource: string, command: MutationEnvelope) {
  return `${resource}:${JSON.stringify(sortJsonValue(command))}`;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    );
  }
  return value;
}

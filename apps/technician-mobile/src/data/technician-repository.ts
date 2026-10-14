import type {
  ActiveTimer,
  AddPartCommand,
  AttachEvidenceCommand,
  CompleteJobCommand,
  DateRange,
  MobileJob,
  MobileStaff,
  MutationReceipt,
  SaveSignOffCommand,
  SaveWorklogCommand,
  ScheduleUnassignedJobCommand,
  StartTimerCommand,
  StoppedTimer,
  StopTimerCommand,
  UpdateStatusCommand,
} from "../contracts/mobile";

export interface TechnicianRepository {
  getActiveTimer?(): Promise<ActiveTimer | null>;
  getCurrentStaff(): Promise<MobileStaff>;
  listCachedSchedule?(range: DateRange): Promise<MobileJob[]>;
  listSchedule(range: DateRange): Promise<MobileJob[]>;
  listUnassignedJobs(): Promise<MobileJob[]>;
  scheduleUnassignedJob(command: ScheduleUnassignedJobCommand): Promise<MutationReceipt>;
  getJob(jobId: string): Promise<MobileJob>;
  startTimer(command: StartTimerCommand): Promise<ActiveTimer>;
  stopTimer(command: StopTimerCommand): Promise<StoppedTimer>;
  saveWorklog(command: SaveWorklogCommand): Promise<MutationReceipt>;
  updateStatus(command: UpdateStatusCommand): Promise<MutationReceipt>;
  attachEvidence(command: AttachEvidenceCommand): Promise<MutationReceipt>;
  addPart(command: AddPartCommand): Promise<MutationReceipt>;
  saveSignOff(command: SaveSignOffCommand): Promise<MutationReceipt>;
  completeJob(command: CompleteJobCommand): Promise<MutationReceipt>;
}

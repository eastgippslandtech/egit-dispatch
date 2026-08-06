import type {
  AddPartCommand,
  AttachEvidenceCommand,
  CompleteJobCommand,
  DateRange,
  MobileJob,
  MobileStaff,
  MutationReceipt,
  SaveSignOffCommand,
  SaveWorklogCommand,
  StartTimerCommand,
  StopTimerCommand,
  UpdateStatusCommand,
} from "../contracts/mobile";
import type { ApiClient } from "../api/client";
import {
  dateKeyIsWithinRange,
  jobDateKey,
} from "../features/schedule/date-keys";

import type { TechnicianRepository } from "./technician-repository";

type DataEnvelope<T> = { data: T };

export function createApiTechnicianRepository(
  api: ApiClient,
): TechnicianRepository {
  return {
    async getCurrentStaff(): Promise<MobileStaff> {
      const response = await api.request<DataEnvelope<{ staff: MobileStaff }>>(
        "/me",
      );
      return response.data.staff;
    },

    async listSchedule(range: DateRange): Promise<MobileJob[]> {
      const params = new URLSearchParams({
        from: range.from,
        to: range.to,
      });
      const response = await api.request<DataEnvelope<{ jobs: MobileJob[] }>>(
        `/jobs?${params.toString()}`,
      );
      return response.data.jobs
        .filter((job) =>
          dateKeyIsWithinRange({
            dateKey: jobDateKey(job.startAt, job.timezone),
            from: range.from,
            to: range.to,
          }),
        )
        .sort((left, right) => left.startAt.localeCompare(right.startAt));
    },

    async getJob(jobId: string): Promise<MobileJob> {
      const response = await api.request<DataEnvelope<{ job: MobileJob }>>(
        `/jobs/${encodeURIComponent(jobId)}`,
      );
      return response.data.job;
    },

    async startTimer(command: StartTimerCommand) {
      const response = await api.request<DataEnvelope<{ timer: never }>>(
        `/jobs/${encodeURIComponent(command.jobId)}/timer/start`,
        { body: command, idempotencyKey: command.clientMutationId },
      );
      return response.data.timer;
    },

    async stopTimer(command: StopTimerCommand) {
      const response = await api.request<DataEnvelope<{ timer: never }>>(
        `/jobs/${encodeURIComponent(command.jobId)}/timer/stop`,
        { body: command, idempotencyKey: command.clientMutationId },
      );
      return response.data.timer;
    },

    saveWorklog(command: SaveWorklogCommand) {
      return sendMutation(api, "notes", command);
    },

    updateStatus(command: UpdateStatusCommand) {
      return sendMutation(api, "status", command);
    },

    attachEvidence(command: AttachEvidenceCommand) {
      return sendMutation(api, "evidence", command);
    },

    addPart(command: AddPartCommand) {
      return sendMutation(api, "parts", command);
    },

    saveSignOff(command: SaveSignOffCommand) {
      return sendMutation(api, "sign-off", command);
    },

    completeJob(command: CompleteJobCommand) {
      return sendMutation(api, "complete", command);
    },
  };
}

async function sendMutation<TCommand extends { clientMutationId: string; jobId: string }>(
  api: ApiClient,
  action: string,
  command: TCommand,
): Promise<MutationReceipt> {
  const response = await api.request<DataEnvelope<{ receipt: MutationReceipt }>>(
    `/jobs/${encodeURIComponent(command.jobId)}/${action}`,
    {
      body: command,
      idempotencyKey: command.clientMutationId,
    },
  );
  return response.data.receipt;
}

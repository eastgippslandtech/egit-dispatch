import type { WorklogDispositionCommand } from "./disposition";

export type WorklogDispositionOperationState =
  | "pending"
  | "worklog_saved"
  | "completed"
  | "recovery_required";

export type WorklogDispositionOperation = {
  command: WorklogDispositionCommand;
  idempotencyKey: string;
  lastError: string | null;
  requestId: string;
  state: WorklogDispositionOperationState;
};

export interface WorklogDispositionRepository {
  begin(command: WorklogDispositionCommand): Promise<WorklogDispositionOperation>;
  markCompleted(idempotencyKey: string): Promise<void>;
  markRecoveryRequired(idempotencyKey: string, error: string): Promise<void>;
  markWorklogSaved(idempotencyKey: string): Promise<void>;
}

export type WorklogDispositionResult = {
  error?: string;
  idempotencyKey: string;
  status: "completed" | "recovery_required";
  worklogSaved: boolean;
};

export function createWorklogDispositionProcessor({
  applyDisposition,
  repository,
  saveWorklog,
}: {
  applyDisposition: (command: WorklogDispositionCommand) => Promise<void>;
  repository: WorklogDispositionRepository;
  saveWorklog: (command: WorklogDispositionCommand) => Promise<void>;
}) {
  return {
    async process(
      command: WorklogDispositionCommand,
    ): Promise<WorklogDispositionResult> {
      const operation = await repository.begin(command);

      if (operation.state === "completed") {
        return completed(command.idempotencyKey);
      }

      if (operation.state === "pending") {
        await saveWorklog(command);
        await repository.markWorklogSaved(command.idempotencyKey);
      }

      if (!command.disposition) {
        await repository.markCompleted(command.idempotencyKey);
        return completed(command.idempotencyKey);
      }

      try {
        await applyDisposition(command);
        await repository.markCompleted(command.idempotencyKey);
        return completed(command.idempotencyKey);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Outcome writeback failed.";
        await repository.markRecoveryRequired(command.idempotencyKey, message);
        return {
          error: message,
          idempotencyKey: command.idempotencyKey,
          status: "recovery_required",
          worklogSaved: true,
        };
      }
    },
  };
}

function completed(idempotencyKey: string): WorklogDispositionResult {
  return {
    idempotencyKey,
    status: "completed",
    worklogSaved: true,
  };
}

import type { EvidenceKind } from "../../contracts/mobile";

export type EvidenceUploadState =
  | "pending"
  | "uploading"
  | "failed"
  | "synced";

export interface StagedEvidence {
  byteLength: number;
  fileName: string;
  id: string;
  jobId: string;
  kind: EvidenceKind;
  lastError: string | null;
  localUri: string;
  mimeType: string;
  progress: number;
  remoteUrl: string | null;
  sha256: string;
  state: EvidenceUploadState;
}

export interface StageEvidenceInput {
  byteLength: number;
  fileName: string;
  jobId: string;
  kind: EvidenceKind;
  localUri: string;
  mimeType: string;
  sha256: string;
}

export function createEvidenceService() {
  const staged = new Map<string, StagedEvidence>();

  return {
    async get(id: string) {
      return cloneOrNull(staged.get(id));
    },
    async markEvidenceUploaded(id: string, remoteUrl: string) {
      const item = requireItem(staged, id);
      item.remoteUrl = remoteUrl;
      item.progress = 100;
      item.state = "synced";
      item.lastError = null;
      staged.set(id, item);
      return clone(item);
    },
    async markFailed(id: string, error: string) {
      const item = requireItem(staged, id);
      item.state = "failed";
      item.lastError = error;
      staged.set(id, item);
      return clone(item);
    },
    async removeLocalEvidenceAfterSync(id: string) {
      const item = requireItem(staged, id);
      if (item.state !== "synced") {
        throw new Error("Local evidence can only be removed after sync.");
      }
      item.localUri = "";
      staged.set(id, item);
      return clone(item);
    },
    async stage(input: StageEvidenceInput) {
      if (!input.localUri.trim() || !input.fileName.trim()) {
        throw new Error("Evidence file and local URI are required.");
      }
      const item: StagedEvidence = {
        ...input,
        id: `evidence-${input.jobId}-${stableEvidenceSuffix(input)}`,
        lastError: null,
        progress: 0,
        remoteUrl: null,
        state: "pending",
      };
      staged.set(item.id, clone(item));
      return clone(item);
    },
  };
}

export async function stageEvidence(
  service: ReturnType<typeof createEvidenceService>,
  input: StageEvidenceInput,
) {
  return service.stage(input);
}

export async function markEvidenceUploaded(
  service: ReturnType<typeof createEvidenceService>,
  id: string,
  remoteUrl: string,
) {
  return service.markEvidenceUploaded(id, remoteUrl);
}

export async function removeLocalEvidenceAfterSync(
  service: ReturnType<typeof createEvidenceService>,
  id: string,
) {
  return service.removeLocalEvidenceAfterSync(id);
}

function stableEvidenceSuffix(input: StageEvidenceInput): string {
  return `${input.sha256}-${input.fileName}`.replace(/[^a-zA-Z0-9]+/g, "-");
}

function requireItem(
  staged: Map<string, StagedEvidence>,
  id: string,
): StagedEvidence {
  const item = staged.get(id);
  if (!item) {
    throw new Error("Staged evidence was not found.");
  }
  return clone(item);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneOrNull<T>(value: T | undefined): T | null {
  return value ? clone(value) : null;
}

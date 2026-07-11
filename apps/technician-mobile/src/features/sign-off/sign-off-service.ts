import type { SaveSignOffCommand } from "../../contracts/mobile";

type SignOffCommandInput = Omit<
  SaveSignOffCommand,
  "clientMutationId" | "signatureLocalUri" | "signedAt"
> & {
  signatureLocalUri: string | null;
};

export function createSignOffCommand({
  accepted,
  baseVersion,
  customerName,
  installationId,
  jobId,
  occurredAt,
  signatureLocalUri,
}: SignOffCommandInput): SaveSignOffCommand {
  if (!accepted || !customerName.trim() || !signatureLocalUri) {
    throw new Error("Customer acceptance and signature are required.");
  }
  return {
    accepted,
    baseVersion,
    clientMutationId: `signoff-${jobId}-${occurredAt}`,
    customerName: customerName.trim(),
    installationId,
    jobId,
    occurredAt,
    signatureLocalUri,
    signedAt: occurredAt,
  };
}

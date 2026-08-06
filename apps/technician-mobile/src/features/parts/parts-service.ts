import type { AddPartCommand } from "../../contracts/mobile";

type PartUsedCommandInput = Omit<AddPartCommand, "clientMutationId" | "note"> & {
  note?: string | null;
};

export function createPartUsedCommand({
  baseVersion,
  installationId,
  jobId,
  name,
  note = null,
  occurredAt,
  quantity,
  sku,
}: PartUsedCommandInput): AddPartCommand {
  if (!name.trim()) {
    throw new Error("Part name is required.");
  }
  if (quantity < 1) {
    throw new Error("Quantity must be at least 1.");
  }
  return {
    baseVersion,
    clientMutationId: `part-${jobId}-${occurredAt}`,
    installationId,
    jobId,
    name: name.trim(),
    note: note?.trim() || null,
    occurredAt,
    quantity,
    sku: sku?.trim() || null,
  };
}

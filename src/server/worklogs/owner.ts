import type { MspCentralClient } from "@/server/msp-central/types";

export async function resolveMspCentralWorklogOwner({
  email,
  mspClient,
  technicianId,
}: {
  email?: string;
  mspClient: MspCentralClient;
  technicianId?: string | null;
}) {
  const storedId = technicianId?.trim();
  if (storedId) {
    return { id: storedId };
  }

  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error(
      "MSP Central technician owner could not be resolved for this account.",
    );
  }

  const technicians = await mspClient.listTechnicians();
  const technician = technicians.find((candidate) =>
    [
      candidate.mspCentralEmail,
      candidate.zohoEmail,
      candidate.outlookUserPrincipalName,
      candidate.outlookEmail,
    ].some((value) => value?.trim().toLowerCase() === normalizedEmail),
  );
  const id = technician?.mspCentralTechnicianId?.trim();

  if (!id) {
    throw new Error(
      "MSP Central technician owner could not be resolved for this account.",
    );
  }

  return { id };
}

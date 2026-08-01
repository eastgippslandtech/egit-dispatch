import type { MspCentralClient } from "@/server/msp-central/types";
import { findStaffForZohoLogin } from "@/server/staff/profiles";

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

  const profileId = findStaffForZohoLogin(normalizedEmail)
    ?.mspCentralTechnicianId?.trim();
  if (profileId) {
    return { id: profileId };
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

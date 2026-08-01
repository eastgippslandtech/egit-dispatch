import { describe, expect, it, vi } from "vitest";

import type { MspCentralClient } from "@/server/msp-central/types";

import { resolveMspCentralWorklogOwner } from "./owner";

describe("MSP Central Work Log owner resolution", () => {
  it("uses a stored MSP technician id without another API lookup", async () => {
    const listTechnicians = vi.fn();

    await expect(
      resolveMspCentralWorklogOwner({
        email: "simeon@egit.com.au",
        mspClient: { listTechnicians } as unknown as MspCentralClient,
        technicianId: "msp-tech-simeon",
      }),
    ).resolves.toEqual({ id: "msp-tech-simeon" });
    expect(listTechnicians).not.toHaveBeenCalled();
  });

  it("uses the canonical EGIT staff profile before the restricted technician directory", async () => {
    const listTechnicians = vi.fn();

    await expect(
      resolveMspCentralWorklogOwner({
        email: "simeon@egit.com.au",
        mspClient: { listTechnicians } as unknown as MspCentralClient,
      }),
    ).resolves.toEqual({ id: "6768000000303165" });
    expect(listTechnicians).not.toHaveBeenCalled();
  });

  it("resolves the signed-in EGIT email against live MSP technicians", async () => {
    const listTechnicians = vi.fn().mockResolvedValue([
      {
        mspCentralEmail: "external-technician@example.com",
        mspCentralTechnicianId: "msp-tech-simeon",
      },
    ]);

    await expect(
      resolveMspCentralWorklogOwner({
        email: "external-technician@example.com",
        mspClient: { listTechnicians } as unknown as MspCentralClient,
      }),
    ).resolves.toEqual({ id: "msp-tech-simeon" });
  });

  it("rejects a Work Log when no MSP owner can be identified", async () => {
    const listTechnicians = vi.fn().mockResolvedValue([]);

    await expect(
      resolveMspCentralWorklogOwner({
        email: "unknown@egit.com.au",
        mspClient: { listTechnicians } as unknown as MspCentralClient,
      }),
    ).rejects.toThrow("MSP Central technician owner could not be resolved");
  });
});

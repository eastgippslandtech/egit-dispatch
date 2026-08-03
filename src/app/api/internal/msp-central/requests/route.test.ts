import { describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { createMspCentralClient } from "@/server/msp-central/client";

import { POST } from "./route";

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

vi.mock("@/server/msp-central/client", () => ({
  createMspCentralClient: vi.fn(),
}));

const getAccessMock = vi.mocked(getCommandCentreAccess);
const createClientMock = vi.mocked(createMspCentralClient);

describe("MSP Central create request route", () => {
  it("rejects a wallboard-only session", async () => {
    getAccessMock.mockResolvedValueOnce({
      name: "Command Centre Wallboard",
      status: "wallboard-only",
    });

    const response = await POST(requestWith({ subject: "Printer offline" }));

    expect(response.status).toBe(403);
  });

  it("requires a subject", async () => {
    approveStaff();

    const response = await POST(requestWith({ subject: "   " }));

    expect(response.status).toBe(400);
  });

  it("creates a request for approved staff", async () => {
    approveStaff();
    const createRequest = vi.fn().mockResolvedValue({
      id: "456",
      requestNumber: "REQ-456",
    });
    createClientMock.mockReturnValue({ createRequest } as never);

    const response = await POST(
      requestWith({
        description: "Printer cannot reach the network.",
        priority: "High",
        requesterEmail: "user@example.com",
        subject: "Printer offline",
      }),
    );

    expect(response.status).toBe(201);
    expect(createRequest).toHaveBeenCalledWith({
      customer: undefined,
      description: "Printer cannot reach the network.",
      priority: "High",
      requesterEmail: "user@example.com",
      site: undefined,
      subject: "Printer offline",
    });
  });
});

function approveStaff() {
  getAccessMock.mockResolvedValueOnce({
    accessLevel: "staff",
    email: "simeon@egit.com.au",
    name: "Simeon",
    status: "approved",
  });
}

function requestWith(body: unknown) {
  return new Request(
    "https://command.egit.com.au/api/internal/msp-central/requests",
    {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

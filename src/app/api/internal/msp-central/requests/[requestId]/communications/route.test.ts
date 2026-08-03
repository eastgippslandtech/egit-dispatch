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

describe("MSP Central communications route", () => {
  it("writes a customer reply and returns refreshed ticket context", async () => {
    getAccessMock.mockResolvedValueOnce({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
    const addRequestNote = vi.fn();
    const context = { customerResponses: [], internalNotes: [], request: {}, worklogs: [] };
    const getRequestContext = vi.fn().mockResolvedValue(context);
    createClientMock.mockReturnValue({ addRequestNote, getRequestContext } as never);

    const response = await POST(
      new Request("https://command.egit.com.au/api/internal/msp-central/requests/123/communications", {
        body: JSON.stringify({ message: "Your printer is back online.", visibility: "customer" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ requestId: "123" }) },
    );

    expect(response.status).toBe(200);
    expect(addRequestNote).toHaveBeenCalledWith({
      description: "Your printer is back online.",
      requestId: "123",
      visibility: "customer",
    });
    await expect(response.json()).resolves.toEqual({
      context,
      ok: true,
      stale: false,
    });
  });

  it("reports a saved message as successful when the context refresh fails", async () => {
    getAccessMock.mockResolvedValueOnce({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
    const addRequestNote = vi.fn().mockResolvedValue(undefined);
    const getRequestContext = vi
      .fn()
      .mockRejectedValue(new Error("Context refresh timed out."));
    createClientMock.mockReturnValue({ addRequestNote, getRequestContext } as never);

    const response = await POST(
      new Request("https://command.egit.com.au/api/internal/msp-central/requests/123/communications", {
        body: JSON.stringify({ message: "Your printer is back online.", visibility: "customer" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ requestId: "123" }) },
    );

    expect(response.status).toBe(200);
    expect(addRequestNote).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({
      context: null,
      ok: true,
      refreshWarning: "Context refresh timed out.",
      stale: true,
    });
  });
});

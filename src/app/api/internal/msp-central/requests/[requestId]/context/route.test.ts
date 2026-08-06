import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { createMspCentralClient } from "@/server/msp-central/client";

import { GET } from "./route";

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

vi.mock("@/server/msp-central/client", () => ({
  createMspCentralClient: vi.fn(),
}));

const getCommandCentreAccessMock = vi.mocked(getCommandCentreAccess);
const createMspCentralClientMock = vi.mocked(createMspCentralClient);

describe("MSP Central request context route", () => {
  beforeEach(() => {
    getCommandCentreAccessMock.mockResolvedValue({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
  });

  it("returns fresh request detail and ticket notes for approved staff", async () => {
    const context = {
      customerResponses: [],
      internalNotes: [],
      request: { id: "123", notes: "Current job description." },
      worklogs: [],
    };
    createMspCentralClientMock.mockReturnValue({
      getRequestContext: vi.fn(async () => context),
    } as never);

    const response = await GET(
      new Request(
        "https://command.egit.com.au/api/internal/msp-central/requests/123/context",
      ),
      { params: Promise.resolve({ requestId: "123" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(context);
  });

  it("rejects wallboard-only access", async () => {
    getCommandCentreAccessMock.mockResolvedValue({
      name: "Command Centre Wallboard",
      status: "wallboard-only",
    });

    const response = await GET(
      new Request(
        "https://command.egit.com.au/api/internal/msp-central/requests/123/context",
      ),
      { params: Promise.resolve({ requestId: "123" }) },
    );

    expect(response.status).toBe(403);
  });
});

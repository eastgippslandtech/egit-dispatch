import { describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";

import { GET } from "./route";

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

const getCommandCentreAccessMock = vi.mocked(getCommandCentreAccess);

describe("identity health route", () => {
  it("requires an approved Command Centre user", async () => {
    getCommandCentreAccessMock.mockResolvedValueOnce({
      status: "unauthenticated",
    });

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("rejects a wallboard-only session", async () => {
    getCommandCentreAccessMock.mockResolvedValueOnce({
      name: "Command Centre Wallboard",
      status: "wallboard-only",
    });

    const response = await GET();

    expect(response.status).toBe(403);
  });

  it("returns the signed-in staff match without leaking unnecessary identity fields", async () => {
    getCommandCentreAccessMock.mockResolvedValueOnce({
      accessLevel: "staff",
      email: "mattd@egit.com.au",
      name: "Matt",
      status: "approved",
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.signedIn).toMatchObject({
      email: "mattd@egit.com.au",
      matchedStaffProfile: {
        baseOffice: "Sale",
        dispatchEnabled: true,
        displayName: "Matt",
        hasMspCentralEmail: true,
        hasOutlookEmail: true,
        role: "technician",
      },
    });
    expect(body.staff[0]).not.toHaveProperty("zohoEmail");
    expect(body.staff[0]).toMatchObject({
      dispatchEnabled: true,
      hasMspCentralEmail: true,
      hasOutlookEmail: true,
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";

import { dispatchRouteAccess } from "./route-auth";

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

const getAccess = vi.mocked(getCommandCentreAccess);

describe("dispatch route access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows an approved staff profile with dispatch enabled", async () => {
    getAccess.mockResolvedValue({
      accessLevel: "staff",
      email: "jervy@egit.com.au",
      name: "Jervy",
      status: "approved",
    });

    await expect(dispatchRouteAccess()).resolves.toMatchObject({
      email: "jervy@egit.com.au",
    });
  });

  it("rejects approved accounts without a dispatch-enabled staff profile", async () => {
    getAccess.mockResolvedValue({
      accessLevel: "staff",
      email: "unknown@egit.com.au",
      name: "Unknown",
      status: "approved",
    });

    await expect(dispatchRouteAccess()).resolves.toBeNull();
  });
});

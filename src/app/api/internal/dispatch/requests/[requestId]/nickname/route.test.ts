import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { getConfiguredRequestNicknameRepository } from "@/server/dispatch/request-nickname-repository";

import { PUT } from "./route";

vi.mock("@/server/auth/session", () => ({
  getCommandCentreAccess: vi.fn(),
  isApprovedStaffAccess: vi.fn((access) => access.status === "approved"),
}));
vi.mock("@/server/dispatch/request-nickname-repository", () => ({
  getConfiguredRequestNicknameRepository: vi.fn(),
}));

const getAccess = vi.mocked(getCommandCentreAccess);
const getRepository = vi.mocked(getConfiguredRequestNicknameRepository);
const context = { params: Promise.resolve({ requestId: "request-1" }) };

function put(nickname: unknown) {
  return PUT(new Request("http://localhost", {
    body: JSON.stringify({ nickname }),
    method: "PUT",
  }), context);
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccess.mockResolvedValue({
    accessLevel: "staff",
    email: "simeon@egit.com.au",
    name: "Simeon",
    status: "approved",
  });
});

describe("ticket nickname route", () => {
  it("stores a normalized shared nickname with the editor identity", async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    getRepository.mockReturnValue({ list: vi.fn(), set } as never);

    const response = await put("  Front   counter printer  ");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ nickname: "Front counter printer" });
    expect(set).toHaveBeenCalledWith("request-1", "Front counter printer", "simeon@egit.com.au");
  });

  it("clears a nickname", async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    getRepository.mockReturnValue({ list: vi.fn(), set } as never);

    const response = await put(null);

    expect(response.status).toBe(200);
    expect(set).toHaveBeenCalledWith("request-1", null, "simeon@egit.com.au");
  });

  it("rejects invalid input without writing", async () => {
    const set = vi.fn();
    getRepository.mockReturnValue({ list: vi.fn(), set } as never);

    const response = await put("x".repeat(81));

    expect(response.status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });

  it("rejects staff without Command Centre access", async () => {
    getAccess.mockResolvedValue({ status: "wallboard-only", email: "viewer@example.com" } as never);
    const response = await put("Front counter printer");

    expect(response.status).toBe(403);
    expect(getRepository).not.toHaveBeenCalled();
  });
});

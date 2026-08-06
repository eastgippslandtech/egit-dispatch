import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { staffRouteAccess } from "@/server/yeastar/route-auth";

import { GET } from "./route";

vi.mock("@/server/integrations/repository", () => ({
  createPostgresIntegrationRepository: vi.fn(),
}));
vi.mock("@/server/yeastar/route-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/yeastar/route-auth")>()),
  staffRouteAccess: vi.fn(),
}));

const access = vi.mocked(staffRouteAccess);
const createRepository = vi.mocked(createPostgresIntegrationRepository);
const getOperation = vi.fn();
const getOperationForActor = vi.fn();
let storedOperation: Record<string, unknown>;

describe("integration operation status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.mockResolvedValue({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
    storedOperation = {
      actionType: "helpdesk.worklog",
      actorEmail: "simeon@egit.com.au",
      attemptCount: 1,
      createdAt: "2026-08-04T01:00:00.000Z",
      id: "operation-1",
      idempotencyKey: "private-idempotency-key",
      inputFingerprint: "private-fingerprint",
      lastError: "refresh_token=private-value request timed out",
      payload: { description: "private customer content" },
      requestId: "REQ-1",
      state: "retrying",
      updatedAt: "2026-08-04T01:01:00.000Z",
    };
    getOperation.mockResolvedValue(storedOperation);
    getOperationForActor.mockResolvedValue(storedOperation);
    createRepository.mockReturnValue({ getOperation, getOperationForActor } as never);
  });

  it("returns a no-store sanitised status for one operation", async () => {
    const response = await GET(new Request("https://command.egit.com.au"), {
      params: Promise.resolve({ operationId: "operation-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(payload).toEqual({
      operation: expect.objectContaining({
        actionType: "helpdesk.worklog",
        id: "operation-1",
        requestId: "REQ-1",
        state: "retrying",
      }),
    });
    expect(JSON.stringify(payload)).not.toContain("private-value");
    expect(JSON.stringify(payload)).not.toContain("private customer content");
    expect(JSON.stringify(payload)).not.toContain("private-idempotency-key");
  });

  it("allows an approved technician to read only their own operation", async () => {
    access.mockResolvedValue({
      accessLevel: "staff",
      email: " approved-tech@egit.com.au ",
      name: "Approved Tech",
      status: "approved",
    });
    getOperationForActor.mockResolvedValueOnce({
      ...storedOperation,
      actorEmail: "approved-tech@egit.com.au",
    });

    const response = await GET(new Request("https://command.egit.com.au"), {
      params: Promise.resolve({ operationId: "operation-1" }),
    });

    expect(response.status).toBe(200);
    expect(getOperationForActor).toHaveBeenCalledWith(
      "operation-1",
      " approved-tech@egit.com.au ",
    );
    expect(getOperation).not.toHaveBeenCalled();
  });

  it("hides another technician's operation without revealing metadata", async () => {
    access.mockResolvedValue({
      accessLevel: "staff",
      email: "approved-tech@egit.com.au",
      name: "Approved Tech",
      status: "approved",
    });
    getOperationForActor.mockRejectedValueOnce(
      new Error("Integration operation was not found."),
    );

    const response = await GET(new Request("https://command.egit.com.au"), {
      params: Promise.resolve({ operationId: "operation-other" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: "Integration action was not found." });
    expect(JSON.stringify(payload)).not.toContain("REQ-");
    expect(getOperation).not.toHaveBeenCalled();
  });

  it("requires approved staff access", async () => {
    access.mockResolvedValue(null);

    const response = await GET(new Request("https://command.egit.com.au"), {
      params: Promise.resolve({ operationId: "operation-1" }),
    });

    expect(response.status).toBe(401);
    expect(createRepository).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { dispatchRouteAccess } from "@/server/yeastar/route-auth";

import { GET } from "./route";

vi.mock("@/server/integrations/repository", () => ({
  createPostgresIntegrationRepository: vi.fn(),
}));
vi.mock("@/server/yeastar/route-auth", () => ({ dispatchRouteAccess: vi.fn() }));

const access = vi.mocked(dispatchRouteAccess);
const createRepository = vi.mocked(createPostgresIntegrationRepository);
const getOperation = vi.fn();

describe("integration operation status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.mockResolvedValue({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
    getOperation.mockResolvedValue({
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
    });
    createRepository.mockReturnValue({ getOperation } as never);
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

  it("requires dispatch access", async () => {
    access.mockResolvedValue(null);

    const response = await GET(new Request("https://command.egit.com.au"), {
      params: Promise.resolve({ operationId: "operation-1" }),
    });

    expect(response.status).toBe(401);
    expect(createRepository).not.toHaveBeenCalled();
  });
});

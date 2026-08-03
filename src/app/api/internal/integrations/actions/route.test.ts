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
const listActionableOperations = vi.fn();

describe("integration failed actions route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.mockResolvedValue({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
    listActionableOperations.mockResolvedValue([
      {
        actionType: "helpdesk.worklog",
        actorEmail: "tech@egit.com.au",
        attemptCount: 2,
        createdAt: "2026-08-03T08:00:00.000Z",
        id: "operation-1",
        idempotencyKey: "hidden-key",
        inputFingerprint: "hidden-fingerprint",
        lastError: "refresh_token=secret-value upstream timeout",
        payload: { description: "private customer content" },
        requestId: "REQ-1",
        state: "review_required",
        updatedAt: "2026-08-03T09:00:00.000Z",
      },
    ]);
    createRepository.mockReturnValue({ listActionableOperations } as never);
  });

  it("requires dispatch/admin access", async () => {
    access.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(createRepository).not.toHaveBeenCalled();
  });

  it("returns only sanitized operational summaries", async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(payload.actions).toEqual([
      expect.objectContaining({
        actionType: "helpdesk.worklog",
        id: "operation-1",
        requestId: "REQ-1",
        state: "review_required",
      }),
    ]);
    expect(JSON.stringify(payload)).not.toContain("secret-value");
    expect(JSON.stringify(payload)).not.toContain("private customer content");
    expect(JSON.stringify(payload)).not.toContain("hidden-key");
  });
});

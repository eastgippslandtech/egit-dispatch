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
const listActionableOperations = vi.fn();
const listActiveOperations = vi.fn();
const listActiveOperationsForActor = vi.fn();

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
    listActiveOperations.mockResolvedValue([]);
    listActiveOperationsForActor.mockResolvedValue([]);
    createRepository.mockReturnValue({
      listActionableOperations,
      listActiveOperations,
      listActiveOperationsForActor,
    } as never);
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

  it("returns active durable operations for dispatch hydration", async () => {
    listActiveOperations.mockResolvedValueOnce([
      {
        actionType: "schedule.booking",
        actorEmail: "dispatcher@egit.com.au",
        attemptCount: 1,
        createdAt: "2026-08-03T08:00:00.000Z",
        id: "operation-active",
        idempotencyKey: "hidden-key",
        inputFingerprint: "hidden-fingerprint",
        payload: { private: true },
        requestId: "REQ-2",
        state: "syncing",
        updatedAt: "2026-08-03T09:00:00.000Z",
      },
    ]);

    const response = await GET(
      new Request("http://localhost/api/internal/integrations/actions?scope=active"),
    );
    const payload = await response.json();

    expect(listActiveOperations).toHaveBeenCalledWith({ limit: 100 });
    expect(payload.actions).toEqual([
      expect.objectContaining({
        id: "operation-active",
        requestId: "REQ-2",
        state: "syncing",
      }),
    ]);
    expect(JSON.stringify(payload)).not.toContain("private");
  });

  it("returns only a technician's own minimal active operations for hydration", async () => {
    access.mockResolvedValue({
      accessLevel: "staff",
      email: " Approved-Tech@EGIT.com.au ",
      name: "Approved Tech",
      status: "approved",
    });
    listActiveOperationsForActor.mockResolvedValueOnce([
      {
        actionType: "helpdesk.worklog",
        actorEmail: "approved-tech@egit.com.au",
        attemptCount: 3,
        createdAt: "2026-08-03T08:00:00.000Z",
        id: "operation-owned",
        idempotencyKey: "secret-key",
        inputFingerprint: "secret-fingerprint",
        lastError: "private provider detail",
        payload: { private: true },
        requestId: "REQ-OWNED",
        state: "review_required",
        updatedAt: "2026-08-03T09:00:00.000Z",
      },
    ]);

    const response = await GET(
      new Request("http://localhost/api/internal/integrations/actions?scope=active"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(listActiveOperationsForActor).toHaveBeenCalledWith({
      actorEmail: " Approved-Tech@EGIT.com.au ",
      limit: 100,
    });
    expect(payload.actions).toEqual([
      {
        id: "operation-owned",
        requestId: "REQ-OWNED",
        state: "review_required",
      },
    ]);
    expect(JSON.stringify(payload)).not.toContain("actorEmail");
    expect(JSON.stringify(payload)).not.toContain("provider detail");
  });

  it("denies failed-action management data to non-dispatch staff", async () => {
    access.mockResolvedValue({
      accessLevel: "staff",
      email: "approved-tech@egit.com.au",
      name: "Approved Tech",
      status: "approved",
    });

    const response = await GET(
      new Request("http://localhost/api/internal/integrations/actions"),
    );

    expect(response.status).toBe(403);
    expect(listActionableOperations).not.toHaveBeenCalled();
    expect(listActiveOperationsForActor).not.toHaveBeenCalled();
  });
});

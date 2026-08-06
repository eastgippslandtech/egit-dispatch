import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { wakeIntegrationProcessor } from "@/server/integrations/wake";
import { dispatchRouteAccess } from "@/server/yeastar/route-auth";

import { POST as cancel } from "./[operationId]/cancel/route";
import { POST as retry } from "./[operationId]/retry/route";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => unknown) => void callback(),
}));
vi.mock("@/server/integrations/repository", () => ({
  createPostgresIntegrationRepository: vi.fn(),
}));
vi.mock("@/server/integrations/wake", () => ({ wakeIntegrationProcessor: vi.fn() }));
vi.mock("@/server/yeastar/route-auth", () => ({ dispatchRouteAccess: vi.fn() }));

const access = vi.mocked(dispatchRouteAccess);
const createRepository = vi.mocked(createPostgresIntegrationRepository);
const wake = vi.mocked(wakeIntegrationProcessor);
const cancelOperationWithAudit = vi.fn();
const retryOperationWithAudit = vi.fn();

describe("integration operator action routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.mockResolvedValue({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
    retryOperationWithAudit.mockResolvedValue({
      id: "operation-1",
      requestId: "REQ-1",
      state: "retrying",
    });
    cancelOperationWithAudit.mockResolvedValue({
      id: "operation-1",
      requestId: "REQ-1",
      state: "cancelled",
    });
    createRepository.mockReturnValue({
      cancelOperationWithAudit,
      retryOperationWithAudit,
    } as never);
    wake.mockResolvedValue(undefined);
  });

  it("retries review-required work, audits the operator, and wakes processing", async () => {
    const response = await retry(request("retry"), context());

    expect(response.status).toBe(202);
    expect(retryOperationWithAudit).toHaveBeenCalledWith({
      actorEmail: "simeon@egit.com.au",
      operationId: "operation-1",
    });
    expect(wake).toHaveBeenCalledWith("operation-1");
  });

  it("requires an explicit confirmed-absent instruction before clearing ambiguity", async () => {
    const response = await retry(request("retry", { confirmAbsent: true }), context());

    expect(response.status).toBe(202);
    expect(retryOperationWithAudit).toHaveBeenCalledWith({
      actorEmail: "simeon@egit.com.au",
      confirmedAbsent: true,
      operationId: "operation-1",
    });
  });

  it("returns conflict when retry is not allowed", async () => {
    retryOperationWithAudit.mockRejectedValue(new Error("not ready for manual retry"));
    const response = await retry(request("retry"), context());
    expect(response.status).toBe(409);
  });

  it("cancels unsynced work and audits the operator", async () => {
    const response = await cancel(request("cancel"), context());

    expect(response.status).toBe(200);
    expect(cancelOperationWithAudit).toHaveBeenCalledWith({
      actorEmail: "simeon@egit.com.au",
      operationId: "operation-1",
    });
  });

  it("rejects cancellation of synced work", async () => {
    cancelOperationWithAudit.mockRejectedValue(new Error("already synced"));
    const response = await cancel(request("cancel"), context());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "This action is currently syncing, already synced, or otherwise not cancellable.",
    });
  });

  it("rejects cancellation of in-flight work without reporting false success", async () => {
    cancelOperationWithAudit.mockRejectedValue(
      new Error("Integration operation is in flight and not cancellable."),
    );

    const response = await cancel(request("cancel"), context());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "This action is currently syncing, already synced, or otherwise not cancellable.",
    });
  });

  it("requires dispatch/admin access for both actions", async () => {
    access.mockResolvedValue(null);
    expect((await retry(request("retry"), context())).status).toBe(401);
    expect((await cancel(request("cancel"), context())).status).toBe(401);
    expect(createRepository).not.toHaveBeenCalled();
  });
});

function request(action: string, body?: Record<string, unknown>) {
  return new Request(
    `https://command.egit.com.au/api/internal/integrations/actions/operation-1/${action}`,
    {
      body: body ? JSON.stringify(body) : undefined,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      method: "POST",
    },
  );
}

function context() {
  return { params: Promise.resolve({ operationId: "operation-1" }) };
}

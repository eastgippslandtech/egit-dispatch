import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";

import { POST } from "./route";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

vi.mock("@/server/integrations/repository", () => ({
  createPostgresIntegrationRepository: vi.fn(),
}));

vi.mock("@/server/integrations/wake", () => ({
  wakeIntegrationProcessor: vi.fn(),
}));

const getAccessMock = vi.mocked(getCommandCentreAccess);
const createRepositoryMock = vi.mocked(createPostgresIntegrationRepository);
const enqueue = vi.fn();

describe("MSP Central merge requests route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccessMock.mockResolvedValue({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
    enqueue.mockResolvedValue({
      operation: { id: "operation-merge-1", state: "queued" },
      replayed: false,
    });
    createRepositoryMock.mockReturnValue({ enqueue } as never);
  });

  it("rejects a wallboard-only session", async () => {
    getAccessMock.mockResolvedValueOnce({
      name: "Command Centre Wallboard",
      status: "wallboard-only",
    });

    const response = await POST(requestWith({}));

    expect(response.status).toBe(403);
  });

  it("rejects merging a request into itself", async () => {
    const response = await POST(
      requestWith({
        childRequestId: "123",
        idempotencyKey: "merge-command-123",
        parentRequestId: "123",
      }),
    );

    expect(response.status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("queues the duplicate child into the surviving parent", async () => {
    const response = await POST(
      requestWith({
        childRequestId: "duplicate-123",
        idempotencyKey: "merge-command-123-456",
        parentRequestId: "surviving-456",
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      childRequestId: "duplicate-123",
      ok: true,
      operationId: "operation-merge-1",
      parentRequestId: "surviving-456",
      status: "queued",
    });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "helpdesk.merge",
        idempotencyKey: "merge-command-123-456",
        payload: {
          childRequestId: "duplicate-123",
          parentRequestId: "surviving-456",
        },
      }),
    );
  });
});

function requestWith(body: unknown) {
  return new Request(
    "https://command.egit.com.au/api/internal/msp-central/merge-requests",
    {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

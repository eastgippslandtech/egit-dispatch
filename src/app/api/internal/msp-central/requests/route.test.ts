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

describe("MSP Central create request route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccessMock.mockResolvedValue({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
    enqueue.mockResolvedValue({
      operation: {
        id: "operation-create-1",
        requestId: "pending:fingerprint",
        state: "queued",
      },
      replayed: false,
    });
    createRepositoryMock.mockReturnValue({ enqueue } as never);
  });

  it("rejects a wallboard-only session", async () => {
    getAccessMock.mockResolvedValueOnce({
      name: "Command Centre Wallboard",
      status: "wallboard-only",
    });

    const response = await POST(requestWith({ subject: "Printer offline" }));

    expect(response.status).toBe(403);
  });

  it("requires a subject and idempotency key", async () => {
    const missingSubject = await POST(
      requestWith({ idempotencyKey: "create-command-1", subject: "   " }),
    );
    const missingKey = await POST(requestWith({ subject: "Printer offline" }));

    expect(missingSubject.status).toBe(400);
    expect(missingKey.status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("queues request creation without an inline provider write", async () => {
    const response = await POST(
      requestWith({
        description: "Printer cannot reach the network.",
        idempotencyKey: "create-command-1",
        priority: "High",
        requesterEmail: "user@example.com",
        subject: "Printer offline",
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      operationId: "operation-create-1",
      pendingRequestId: "pending:fingerprint",
      status: "queued",
    });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "helpdesk.create_request",
        actorEmail: "simeon@egit.com.au",
        idempotencyKey: "create-command-1",
        steps: [
          expect.objectContaining({ stepKey: "msp:create-request" }),
          expect.objectContaining({ stepKey: "command:refresh" }),
        ],
      }),
    );
  });
});

function requestWith(body: unknown) {
  return new Request(
    "https://command.egit.com.au/api/internal/msp-central/requests",
    {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

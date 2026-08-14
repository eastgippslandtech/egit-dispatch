import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { wakeIntegrationProcessor } from "@/server/integrations/wake";

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
const wakeIntegrationProcessorMock = vi.mocked(wakeIntegrationProcessor);
const enqueue = vi.fn();
const getStepResults = vi.fn();

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
    getStepResults.mockResolvedValue({});
    createRepositoryMock.mockReturnValue({ enqueue, getStepResults } as never);
    wakeIntegrationProcessorMock.mockResolvedValue(undefined);
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
        category: "Hardware",
        description: "Printer cannot reach the network.",
        contactId: "contact-1",
        customer: "Example Co",
        customerId: "customer-1",
        impact: "Affects User",
        idempotencyKey: "create-command-1",
        priority: "High",
        requestType: "Incident",
        requesterEmail: "user@example.com",
        site: "137 Main Street, Bairnsdale VIC 3875",
        subcategory: "Printer",
        subject: "Printer offline",
        urgency: "High",
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
        payload: expect.objectContaining({
          contactId: "contact-1",
          category: "Hardware",
          customer: "Example Co",
          customerId: "customer-1",
          impact: "Affects User",
          requestType: "Incident",
          requesterEmail: "user@example.com",
          subcategory: "Printer",
          urgency: "High",
        }),
        steps: [
          expect.objectContaining({
            payload: expect.objectContaining({
              contactId: "contact-1",
              customerId: "customer-1",
            }),
            stepKey: "msp:create-request",
          }),
          expect.objectContaining({ stepKey: "command:refresh" }),
        ],
      }),
    );
  });

  it("can wait for the created MSP Central request before scheduling", async () => {
    getStepResults.mockResolvedValueOnce({
      "msp:create-request": {
        externalId: "6768000001520715",
        requestNumber: "22336",
      },
    });

    const response = await POST(
      requestWith({
        customer: "Example Co",
        customerId: "customer-1",
        idempotencyKey: "create-command-1",
        priority: "Medium",
        requesterEmail: "user@example.com",
        site: "137 Main Street, Bairnsdale VIC 3875",
        subject: "Printer offline",
        waitForProvider: true,
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      createdRequestId: "6768000001520715",
      createdRequestNumber: "22336",
      ok: true,
      operationId: "operation-create-1",
      pendingRequestId: "pending:fingerprint",
      status: "queued",
    });
    expect(wakeIntegrationProcessorMock).toHaveBeenCalledWith("operation-create-1");
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

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { wakeIntegrationProcessor } from "@/server/integrations/wake";

import { POST } from "./route";

const afterTasks = vi.hoisted(
  () => [] as Array<() => Promise<unknown> | unknown>,
);

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn((task: () => Promise<unknown> | unknown) => afterTasks.push(task)),
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
const wakeMock = vi.mocked(wakeIntegrationProcessor);
const enqueue = vi.fn();

describe("MSP Central communications route", () => {
  beforeEach(() => {
    afterTasks.length = 0;
    vi.clearAllMocks();
    getAccessMock.mockResolvedValue({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
    enqueue.mockResolvedValue({
      operation: { id: "operation-comms-1", state: "queued" },
      replayed: false,
    });
    createRepositoryMock.mockReturnValue({ enqueue } as never);
    wakeMock.mockResolvedValue(undefined);
  });

  it("requires an idempotency key and does not enqueue partial input", async () => {
    const response = await POST(requestWith({ message: "Printer is online." }), {
      params: Promise.resolve({ requestId: "123" }),
    });

    expect(response.status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ["customer", true],
    ["internal", false],
  ] as const)("queues a %s message without writing to MSP Central inline", async (visibility, showToRequester) => {
    const response = await POST(
      requestWith({
        idempotencyKey: `comms-command-${visibility}`,
        message: "The printer is back online.",
        occurredAt: "2026-08-04T10:00:00+10:00",
        visibility,
      }),
      { params: Promise.resolve({ requestId: "123" }) },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      operationId: "operation-comms-1",
      status: "queued",
    });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "helpdesk.communication",
        actorEmail: "simeon@egit.com.au",
        idempotencyKey: `comms-command-${visibility}`,
        requestId: "123",
        steps: [
          expect.objectContaining({
            payload: expect.objectContaining({
              notifyTechnician: false,
              showToRequester,
              visibility,
            }),
            stepKey: "msp:communication",
          }),
          expect.objectContaining({ stepKey: "command:refresh" }),
        ],
      }),
    );
    expect(afterTasks).toHaveLength(1);
  });
});

function requestWith(body: unknown) {
  return new Request(
    "https://command.egit.com.au/api/internal/msp-central/requests/123/communications",
    {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

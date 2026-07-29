import { describe, expect, it, vi } from "vitest";

import type { DispatchRequest } from "@/server/dispatch/types";
import type { MspCentralClient } from "@/server/msp-central/types";

import {
  processTechnicianNotifications,
  type NotificationRepository,
} from "./poll";

const request: DispatchRequest = {
  ageHours: 0,
  billable: true,
  contact: "advanced@example.invalid",
  customer: "Advanced Works",
  dueAt: "2026-07-29T22:00:00+10:00",
  id: "aw-1001",
  priority: "High",
  readyToBook: true,
  requester: "Advanced Works",
  requestNumber: "REQ-AW-1001",
  site: "Bairnsdale",
  siteTown: "Bairnsdale",
  slaState: "normal",
  sourceSystem: "msp-central",
  status: "Open",
  subject: "After-hours network outage",
  technicianId: "tech-jervy",
  updatedAt: "2026-07-29T19:01:00+10:00",
  warnings: [
    "Auto-assigned by Advanced Works/Viridian IT site proximity.",
  ],
};

function createRepository(): NotificationRepository & {
  sent: string[];
  states: Map<string, Parameters<NotificationRepository["saveState"]>[0]>;
} {
  const states = new Map<
    string,
    Parameters<NotificationRepository["saveState"]>[0]
  >();
  const sent: string[] = [];

  return {
    sent,
    states,
    async getState(requestId) {
      return states.get(requestId);
    },
    async listPushTokens() {
      return ["ExponentPushToken[jervy]"];
    },
    async recordDelivery(input) {
      sent.push(input.eventKey);
    },
    async saveState(state) {
      states.set(state.requestId, state);
    },
  };
}

describe("technician notification poll", () => {
  it("assigns and immediately notifies a new after-hours Advanced Works request", async () => {
    const assignRequest = vi.fn(async () => undefined);
    const client = {
      assignRequest,
      listRequests: async () => [request],
    } as unknown as MspCentralClient;
    const repository = createRepository();
    const sendPush = vi.fn(async () => ({ receiptId: "expo-1" }));

    const result = await processTechnicianNotifications({
      client,
      now: new Date("2026-07-29T19:02:00+10:00"),
      repository,
      sendPush,
    });

    expect(assignRequest).toHaveBeenCalledWith({
      requestId: "aw-1001",
      technicianName: "Jervy",
    });
    expect(sendPush).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("After-hours network outage"),
        to: "ExponentPushToken[jervy]",
      }),
    );
    expect(result.sent).toBe(1);
  });

  it("does not send the same notification again on the next poll", async () => {
    const client = {
      assignRequest: vi.fn(async () => undefined),
      listRequests: async () => [request],
    } as unknown as MspCentralClient;
    const repository = createRepository();
    const sendPush = vi.fn(async () => ({ receiptId: "expo-1" }));

    await processTechnicianNotifications({
      client,
      now: new Date("2026-07-29T19:02:00+10:00"),
      repository,
      sendPush,
    });
    await processTechnicianNotifications({
      client,
      now: new Date("2026-07-29T19:03:00+10:00"),
      repository,
      sendPush,
    });

    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("uses batched repository reads and writes when available", async () => {
    const states = new Map<
      string,
      Parameters<NotificationRepository["saveState"]>[0]
    >();
    const getState = vi.fn(async () => undefined);
    const listPushTokens = vi.fn(async () => []);
    const saveState = vi.fn(async () => undefined);
    const getStates = vi.fn(async () => states);
    const listPushTokensByTechnician = vi.fn(
      async () =>
        new Map([["tech-jervy", ["ExponentPushToken[jervy]"]]]),
    );
    const saveStates = vi.fn(async (nextStates) => {
      for (const state of nextStates) {
        states.set(state.requestId, state);
      }
    });
    const repository: NotificationRepository = {
      getState,
      getStates,
      listPushTokens,
      listPushTokensByTechnician,
      recordDelivery: vi.fn(async () => undefined),
      saveState,
      saveStates,
    };
    const client = {
      assignRequest: vi.fn(async () => undefined),
      listRequests: async () => [request],
    } as unknown as MspCentralClient;

    await processTechnicianNotifications({
      client,
      now: new Date("2026-07-29T19:02:00+10:00"),
      repository,
      sendPush: vi.fn(async () => ({ receiptId: "expo-batch" })),
    });

    expect(getStates).toHaveBeenCalledWith(["aw-1001"]);
    expect(listPushTokensByTechnician).toHaveBeenCalledWith(["tech-jervy"]);
    expect(saveStates).toHaveBeenCalledOnce();
    expect(getState).not.toHaveBeenCalled();
    expect(listPushTokens).not.toHaveBeenCalled();
    expect(saveState).not.toHaveBeenCalled();
  });

  it("notifies a technician when a recent assigned request is first observed", async () => {
    const assignedRequest = {
      ...request,
      customer: "OneHarvest",
      warnings: [],
    };
    const client = {
      assignRequest: vi.fn(async () => undefined),
      listRequests: async () => [assignedRequest],
    } as unknown as MspCentralClient;
    const repository = createRepository();
    const sendPush = vi.fn(async () => ({ receiptId: "expo-assignment" }));

    await processTechnicianNotifications({
      client,
      now: new Date("2026-07-29T14:02:00+10:00"),
      repository,
      sendPush,
    });

    expect(client.assignRequest).not.toHaveBeenCalled();
    expect(sendPush).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Ticket assigned",
        to: "ExponentPushToken[jervy]",
      }),
    );
  });

  it("keeps regular request updates quiet outside office hours", async () => {
    const regularRequest = {
      ...request,
      customer: "OneHarvest",
      status: "Scheduled" as const,
      warnings: [],
    };
    const repository = createRepository();
    repository.states.set(request.id, {
      fingerprint: "previous",
      priority: regularRequest.priority,
      requestId: regularRequest.id,
      requestNumber: regularRequest.requestNumber,
      status: "Open",
      technicianId: regularRequest.technicianId,
      updatedAt: "2026-07-29T18:55:00+10:00",
    });
    const sendPush = vi.fn(async () => ({ receiptId: "expo-quiet" }));
    const client = {
      assignRequest: vi.fn(async () => undefined),
      listRequests: async () => [regularRequest],
    } as unknown as MspCentralClient;

    await processTechnicianNotifications({
      client,
      now: new Date("2026-07-29T19:03:00+10:00"),
      repository,
      sendPush,
    });

    expect(sendPush).not.toHaveBeenCalled();
  });

  it.each([
    ["before 9 AM", "2026-07-29T08:59:00+10:00"],
    ["from 5 PM", "2026-07-29T17:00:00+10:00"],
    ["on weekends", "2026-08-01T12:00:00+10:00"],
  ])("keeps regular assignments quiet %s", async (_label, timestamp) => {
    const regularRequest = {
      ...request,
      customer: "OneHarvest",
      warnings: [],
    };
    const sendPush = vi.fn(async () => ({ receiptId: "expo-quiet" }));
    const client = {
      assignRequest: vi.fn(async () => undefined),
      listRequests: async () => [regularRequest],
    } as unknown as MspCentralClient;

    await processTechnicianNotifications({
      client,
      now: new Date(timestamp),
      repository: createRepository(),
      sendPush,
    });

    expect(sendPush).not.toHaveBeenCalled();
  });

  it("allows Advanced Works request updates outside office hours", async () => {
    const updatedRequest = {
      ...request,
      status: "Scheduled" as const,
    };
    const repository = createRepository();
    repository.states.set(request.id, {
      fingerprint: "previous",
      priority: updatedRequest.priority,
      requestId: updatedRequest.id,
      requestNumber: updatedRequest.requestNumber,
      status: "Open",
      technicianId: updatedRequest.technicianId,
      updatedAt: "2026-07-29T18:55:00+10:00",
    });
    const sendPush = vi.fn(async () => ({ receiptId: "expo-after-hours" }));
    const client = {
      assignRequest: vi.fn(async () => undefined),
      listRequests: async () => [updatedRequest],
    } as unknown as MspCentralClient;

    await processTechnicianNotifications({
      client,
      now: new Date("2026-07-29T19:03:00+10:00"),
      repository,
      sendPush,
    });

    expect(sendPush).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Ticket status changed" }),
    );
  });

  it("does not notify a technician about their own update", async () => {
    const repository = createRepository();
    repository.states.set(request.id, {
      fingerprint: "previous",
      priority: request.priority,
      requestId: request.id,
      requestNumber: request.requestNumber,
      status: request.status,
      technicianId: request.technicianId,
      updatedAt: "2026-07-29T18:55:00+10:00",
    });
    const sendPush = vi.fn(async () => ({ receiptId: "expo-self" }));
    const client = {
      assignRequest: vi.fn(async () => undefined),
      listRequests: async () => [
        {
          ...request,
          updatedByEmail: "jervy@egit.com.au",
        },
      ],
    } as unknown as MspCentralClient;

    await processTechnicianNotifications({
      client,
      now: new Date("2026-07-29T19:03:00+10:00"),
      repository,
      sendPush,
    });

    expect(sendPush).not.toHaveBeenCalled();
  });
});

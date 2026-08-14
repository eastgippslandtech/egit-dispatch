import { describe, expect, it, vi } from "vitest";

import type { IntegrationOperationStep } from "../types";
import { createPushNotificationAdapters } from "./push";

describe("push notification integration adapters", () => {
  it("sends a scheduled job push to every registered device", async () => {
    const recordDelivery = vi.fn(async () => undefined);
    const sendPush = vi.fn(async () => ({ receiptId: "expo-1" }));
    const adapters = createPushNotificationAdapters({
      now: () => new Date("2026-08-04T10:00:00+10:00"),
      repository: {
        listPushTokens: async () => [
          "ExponentPushToken[simeon-phone]",
          "ExponentPushToken[simeon-ipad]",
        ],
        recordDelivery,
      },
      sendPush,
    });

    await adapters["push.notify"].execute(
      step({
        body: "22385: Email Trane",
        eventKey: "schedule:22385:v1:push:tech-simeon",
        eventType: "assignment",
        requestId: "6768000001482447",
        requestNumber: "22385",
        technicianId: "tech-simeon",
        title: "Ticket assigned",
      }),
    );

    expect(sendPush).toHaveBeenCalledTimes(2);
    expect(sendPush).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "22385: Email Trane",
        data: {
          eventType: "assignment",
          requestId: "6768000001482447",
          requestNumber: "22385",
        },
        title: "Ticket assigned",
        to: "ExponentPushToken[simeon-phone]",
      }),
    );
    expect(recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: "schedule:22385:v1:push:tech-simeon",
        eventType: "assignment",
        requestId: "6768000001482447",
        status: "sent",
        technicianId: "tech-simeon",
      }),
    );
  });

  it("records no-device delivery without failing the schedule operation", async () => {
    const recordDelivery = vi.fn(async () => undefined);
    const sendPush = vi.fn(async () => ({ receiptId: "expo-unused" }));
    const adapters = createPushNotificationAdapters({
      now: () => new Date("2026-08-04T10:00:00+10:00"),
      repository: {
        listPushTokens: async () => [],
        recordDelivery,
      },
      sendPush,
    });

    await expect(
      adapters["push.notify"].execute(
        step({
          body: "22385: Email Trane",
          eventKey: "schedule:22385:v1:push:tech-simeon",
          eventType: "assignment",
          requestId: "6768000001482447",
          requestNumber: "22385",
          technicianId: "tech-simeon",
          title: "Ticket assigned",
        }),
      ),
    ).resolves.toMatchObject({ delivered: 0, status: "no_device" });

    expect(sendPush).not.toHaveBeenCalled();
    expect(recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ status: "no_device" }),
    );
  });

  it("records failed delivery without failing the schedule operation", async () => {
    const recordDelivery = vi.fn(async () => undefined);
    const sendPush = vi.fn(async () => {
      throw new Error("DeviceNotRegistered");
    });
    const adapters = createPushNotificationAdapters({
      now: () => new Date("2026-08-04T10:00:00+10:00"),
      repository: {
        listPushTokens: async () => ["ExponentPushToken[stale-riley-phone]"],
        recordDelivery,
      },
      sendPush,
    });

    await expect(
      adapters["push.notify"].execute(
        step({
          body: "22385: Email Trane",
          eventKey: "schedule:22385:v1:push:tech-riley",
          eventType: "assignment",
          requestId: "6768000001482447",
          requestNumber: "22385",
          technicianId: "tech-riley",
          title: "Ticket assigned",
        }),
      ),
    ).resolves.toMatchObject({
      delivered: 0,
      failed: 1,
      status: "failed",
    });

    expect(recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: "schedule:22385:v1:push:tech-riley",
        status: "failed",
        technicianId: "tech-riley",
      }),
    );
  });

  it("keeps normal phone notifications quiet outside office hours", async () => {
    const recordDelivery = vi.fn(async () => undefined);
    const sendPush = vi.fn(async () => ({ receiptId: "expo-quiet" }));
    const adapters = createPushNotificationAdapters({
      now: () => new Date("2026-08-04T18:00:00+10:00"),
      repository: {
        listPushTokens: async () => ["ExponentPushToken[simeon-phone]"],
        recordDelivery,
      },
      sendPush,
    });

    await expect(
      adapters["push.notify"].execute(
        step({
          body: "22385: Email Trane",
          customer: "Trane",
          eventKey: "schedule:22385:v1:push:tech-simeon",
          eventType: "assignment",
          requestId: "6768000001482447",
          requestNumber: "22385",
          technicianId: "tech-simeon",
          title: "Ticket assigned",
        }),
      ),
    ).resolves.toMatchObject({ delivered: 0, status: "quiet_hours" });

    expect(sendPush).not.toHaveBeenCalled();
    expect(recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ status: "no_device" }),
    );
  });

  it("allows Advanced Works and Viridian phone notifications outside office hours", async () => {
    const sendPush = vi.fn(async () => ({ receiptId: "expo-aw" }));
    const adapters = createPushNotificationAdapters({
      now: () => new Date("2026-08-04T18:00:00+10:00"),
      repository: {
        listPushTokens: async () => ["ExponentPushToken[simeon-phone]"],
        recordDelivery: vi.fn(async () => undefined),
      },
      sendPush,
    });

    await adapters["push.notify"].execute(
      step({
        body: "22385: Email Trane",
        customer: "Viridian IT",
        eventKey: "schedule:22385:v1:push:tech-simeon",
        eventType: "assignment",
        requestId: "6768000001482447",
        requestNumber: "22385",
        technicianId: "tech-simeon",
        title: "Ticket assigned",
      }),
    );

    expect(sendPush).toHaveBeenCalledOnce();
  });
});

function step(payload: Record<string, unknown>): IntegrationOperationStep {
  return {
    action: "push.notify",
    attemptCount: 1,
    connector: "push",
    createdAt: "2026-08-04T00:00:00.000Z",
    id: "step-push",
    leaseToken: "lease-1",
    operationId: "operation-1",
    payload,
    requiresReconciliation: false,
    state: "processing",
    stepKey: "push:assignment:tech-simeon",
    stepOrder: 0,
    updatedAt: "2026-08-04T00:00:00.000Z",
  };
}

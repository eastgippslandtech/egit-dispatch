import { describe, expect, it, vi } from "vitest";

import type { IntegrationOperationStep } from "../types";
import { createEmailAdapters } from "./email";

describe("email integration adapters", () => {
  it("sends a technician schedule confirmation through Microsoft Graph", async () => {
    const sendMail = vi.fn().mockResolvedValue({ id: "mail-1" });
    const adapters = createEmailAdapters({
      fromUserPrincipalName: "support@egit.com.au",
      graphClient: { sendMail },
    });

    const result = await adapters[
      "email.send_technician_schedule_confirmation"
    ].execute(
      step({
        html: "<p>Ticket scheduled</p>",
        plainText: "Ticket scheduled",
        subjectLine: "Scheduled: 22240 RSS job",
        toEmail: "jervy@egit.com.au",
      }),
    );

    expect(
      adapters["email.send_technician_schedule_confirmation"].writeSafety,
    ).toBe("idempotent");
    expect(sendMail).toHaveBeenCalledWith({
      fromUserPrincipalName: "support@egit.com.au",
      html: "<p>Ticket scheduled</p>",
      plainText: "Ticket scheduled",
      subject: "Scheduled: 22240 RSS job",
      to: "jervy@egit.com.au",
    });
    expect(result).toEqual({
      externalId: "mail-1",
      sent: true,
      toEmail: "jervy@egit.com.au",
    });
  });

  it("requires a configured sender mailbox", async () => {
    const adapters = createEmailAdapters({
      graphClient: { sendMail: vi.fn() },
    });

    await expect(
      adapters["email.send_technician_schedule_confirmation"].execute(
        step({
          plainText: "Ticket scheduled",
          subjectLine: "Scheduled",
          toEmail: "jervy@egit.com.au",
        }),
      ),
    ).rejects.toThrow("Command Centre notification sender email is not configured.");
  });
});

function step(payload: Record<string, unknown>): IntegrationOperationStep {
  return {
    action: "email.send_technician_schedule_confirmation",
    attemptCount: 1,
    connector: "email",
    createdAt: "2026-08-04T00:00:00.000Z",
    id: "step-email",
    leaseToken: "lease-1",
    operationId: "operation-1",
    payload,
    requiresReconciliation: false,
    state: "processing",
    stepKey: "email:assignment:tech-jervy",
    stepOrder: 0,
    updatedAt: "2026-08-04T00:00:00.000Z",
  };
}

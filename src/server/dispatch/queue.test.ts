import { describe, expect, it } from "vitest";

import type { DispatchRequest } from "./types";
import {
  dispatchQueueCounts,
  requestAttentionReason,
  requestMatchesDispatchQueue,
} from "./queue";

describe("dispatch queue", () => {
  it("separates unassigned, personal, and assigned queues", () => {
    const unassigned = request({ id: "new", technicianId: undefined });
    const mine = request({ id: "mine", technicianId: "tech-simeon" });
    const other = request({ id: "other", technicianId: "tech-matt" });

    expect(requestMatchesDispatchQueue(unassigned, "new", "tech-simeon", new Set())).toBe(true);
    expect(requestMatchesDispatchQueue(mine, "mine", "tech-simeon", new Set())).toBe(true);
    expect(requestMatchesDispatchQueue(other, "mine", "tech-simeon", new Set())).toBe(false);
    expect(requestMatchesDispatchQueue(mine, "assigned", "tech-simeon", new Set())).toBe(true);
    expect(requestMatchesDispatchQueue(other, "assigned", "tech-simeon", new Set())).toBe(true);
  });

  it("keeps updated requests unread until explicitly seen", () => {
    const updated = request({
      id: "updated",
      updateInfo: {
        at: "2026-08-04T01:00:00.000Z",
        source: "msp-central",
        summary: "Customer replied",
      },
    });

    expect(requestMatchesDispatchQueue(updated, "updated", undefined, new Set())).toBe(true);
    expect(requestMatchesDispatchQueue(updated, "updated", undefined, new Set(["updated"]))).toBe(false);
    expect(requestAttentionReason(updated, new Set())).toBe("Customer replied");
  });

  it("detects waiting, SLA, and failed-sync attention", () => {
    const waiting = request({ warnings: ["Waiting customer"] });
    const sla = request({ slaState: "overdue" });
    const failed = request({ warnings: ["Provider sync failed"] });

    expect(requestMatchesDispatchQueue(waiting, "waiting", undefined, new Set())).toBe(true);
    expect(requestMatchesDispatchQueue(sla, "sla-risk", undefined, new Set())).toBe(true);
    expect(requestMatchesDispatchQueue(failed, "failed-sync", undefined, new Set())).toBe(true);
    expect(requestAttentionReason(sla, new Set())).toBe("SLA overdue");
    expect(requestAttentionReason(failed, new Set())).toBe("Provider sync failed");
  });

  it("excludes resolved requests from operational queues and reports counts", () => {
    const requests = [
      request({ id: "new", technicianId: undefined }),
      request({ id: "mine", technicianId: "tech-simeon", slaState: "due-soon" }),
      request({ id: "resolved", status: "Resolved", technicianId: "tech-simeon" }),
    ];

    expect(requestMatchesDispatchQueue(requests[2]!, "mine", "tech-simeon", new Set())).toBe(false);
    expect(dispatchQueueCounts(requests, "tech-simeon", new Set())).toMatchObject({
      assigned: 1,
      mine: 1,
      new: 1,
      "sla-risk": 1,
    });
  });
});

function request(overrides: Partial<DispatchRequest> = {}): DispatchRequest {
  return {
    ageHours: 2,
    billable: false,
    contact: "User / user@example.com",
    customer: "EGIT",
    dueAt: "2026-08-04T05:00:00.000Z",
    id: "request-1",
    priority: "Medium",
    readyToBook: true,
    requestNumber: "REQ-1",
    requester: "User",
    site: "Bairnsdale",
    slaState: "normal",
    status: "Open",
    subject: "Test request",
    warnings: [],
    ...overrides,
  };
}

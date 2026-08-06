import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { getConfiguredRequestWorkflowRepository } from "@/server/dispatch/service-workflow-repository";

import { GET, POST } from "./route";

vi.mock("@/server/auth/session", () => ({
  getCommandCentreAccess: vi.fn(),
  isApprovedStaffAccess: vi.fn((access) => access.status === "approved"),
}));
vi.mock("@/server/dispatch/service-workflow-repository", () => ({
  getConfiguredRequestWorkflowRepository: vi.fn(),
}));

const getAccess = vi.mocked(getCommandCentreAccess);
const getRepository = vi.mocked(getConfiguredRequestWorkflowRepository);
const context = { params: Promise.resolve({ requestId: "request-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  getAccess.mockResolvedValue({
    accessLevel: "staff",
    email: "simeon@egit.com.au",
    name: "Simeon",
    status: "approved",
  });
});

describe("request workflow route", () => {
  it("returns the current workflow", async () => {
    const workflow = { requestId: "request-1", templateId: "general-support" };
    getRepository.mockReturnValue({ get: vi.fn().mockResolvedValue(workflow), save: vi.fn() } as never);

    const response = await GET(new Request("http://localhost"), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ workflow });
  });

  it("manually applies a template and persists its Track", async () => {
    const save = vi.fn();
    getRepository.mockReturnValue({ get: vi.fn(), save } as never);
    const response = await POST(
      new Request("http://localhost", {
        body: JSON.stringify({ action: "apply_template", templateId: "general-support" }),
        method: "POST",
      }),
      context,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.workflow).toMatchObject({
      classification: { source: "manual" },
      templateId: "general-support",
    });
    expect(save).toHaveBeenCalledOnce();
  });

  it("rejects automatic template application below the confidence threshold", async () => {
    getRepository.mockReturnValue({ get: vi.fn(), save: vi.fn() } as never);
    const response = await POST(
      new Request("http://localhost", {
        body: JSON.stringify({
          action: "apply_template",
          automatic: true,
          request: { subject: "Computer issue" },
          templateId: "general-support",
        }),
        method: "POST",
      }),
      context,
    );

    expect(response.status).toBe(400);
  });

  it("updates a Track item and requires an N/A reason", async () => {
    const save = vi.fn();
    const { applyTicketTemplate, serviceTicketTemplates } = await import(
      "@/server/dispatch/service-workflow"
    );
    const stored = applyTicketTemplate({
      actorEmail: "simeon@egit.com.au",
      classification: {
        confidence: 1,
        reason: "Manual",
        source: "manual",
        templateId: "general-support",
      },
      requestId: "request-1",
      template: serviceTicketTemplates[0],
    });
    getRepository.mockReturnValue({ get: vi.fn().mockResolvedValue(stored), save } as never);
    const response = await POST(
      new Request("http://localhost", {
        body: JSON.stringify({
          action: "update_track_item",
          itemId: stored.track!.items[0].id,
          status: "not_applicable",
        }),
        method: "POST",
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
});

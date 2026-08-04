import { describe, expect, it } from "vitest";

import type { DispatchRequest } from "./types";
import {
  applyTicketTemplate,
  classifyTicketTemplate,
  evaluateClosureGuardrails,
  serviceTicketTemplates,
  updateTrackItem,
} from "./service-workflow";

const request: DispatchRequest = {
  ageHours: 1,
  billable: true,
  contact: "simeon@egit.com.au",
  customer: "East Gippsland IT",
  dueAt: "2026-08-05T07:00:00.000Z",
  id: "request-1",
  priority: "Medium",
  readyToBook: true,
  requester: "Simeon",
  requestNumber: "REQ-1",
  site: "Bairnsdale office",
  slaState: "normal",
  status: "Open",
  subject: "New user onboarding for Alex",
  warnings: [],
};

describe("ticket template classification", () => {
  it("returns a high-confidence deterministic onboarding match", () => {
    expect(classifyTicketTemplate(request)).toMatchObject({
      confidence: 0.96,
      source: "deterministic",
      templateId: "user-onboarding",
    });
  });

  it("does not suggest a template for an ambiguous request", () => {
    expect(
      classifyTicketTemplate({ ...request, subject: "Computer issue" }),
    ).toBeNull();
  });

  it("does not allow a low-confidence Zia suggestion to auto-apply", () => {
    expect(
      classifyTicketTemplate(request, {
        ziaSuggestion: { confidence: 0.89, templateId: "user-onboarding" },
      }),
    ).toMatchObject({ source: "deterministic" });
    expect(
      classifyTicketTemplate(
        { ...request, subject: "Computer issue" },
        { ziaSuggestion: { confidence: 0.89, templateId: "user-onboarding" } },
      ),
    ).toBeNull();
  });

  it("classifies a new device setup request into the device workflow", () => {
    expect(
      classifyTicketTemplate({
        ...request,
        subject: "New device setup for Alex",
      }),
    ).toMatchObject({
      confidence: 0.94,
      source: "deterministic",
      templateId: "device-deployment",
    });
  });
});

describe("Tracks", () => {
  it("creates a versioned Track snapshot when a template is applied", () => {
    const template = serviceTicketTemplates.find(
      (candidate) => candidate.id === "user-onboarding",
    )!;
    const workflow = applyTicketTemplate({
      actorEmail: "simeon@egit.com.au",
      classification: {
        confidence: 1,
        reason: "Dispatcher selected the template.",
        source: "manual",
        templateId: template.id,
      },
      now: "2026-08-04T01:00:00.000Z",
      requestId: request.id,
      template,
    });

    expect(workflow.templateVersion).toBe(template.version);
    expect(workflow.track?.version).toBe(template.track?.version);
    expect(workflow.track?.items.every((item) => item.status === "pending")).toBe(true);
  });

  it("requires a reason before a mandatory item can be marked not applicable", () => {
    const template = serviceTicketTemplates[0];
    const workflow = applyTicketTemplate({
      actorEmail: "simeon@egit.com.au",
      classification: {
        confidence: 1,
        reason: "Manual selection",
        source: "manual",
        templateId: template.id,
      },
      requestId: request.id,
      template,
    });

    expect(() =>
      updateTrackItem(workflow, workflow.track!.items[0].id, {
        actorEmail: "simeon@egit.com.au",
        status: "not_applicable",
      }),
    ).toThrow("reason");
  });

  it("requires captured evidence for value-based Track items", () => {
    const template = serviceTicketTemplates.find(
      (candidate) => candidate.id === "user-onboarding",
    )!;
    const workflow = applyTicketTemplate({
      actorEmail: "simeon@egit.com.au",
      classification: {
        confidence: 1,
        reason: "Manual selection",
        source: "manual",
        templateId: template.id,
      },
      requestId: request.id,
      template,
    });
    const textItem = workflow.track!.items.find((item) => item.type === "text")!;

    expect(() =>
      updateTrackItem(workflow, textItem.id, {
        actorEmail: "simeon@egit.com.au",
        status: "completed",
      }),
    ).toThrow("required detail");
  });

  it("captures the required new device setup details before build and handover", () => {
    const template = serviceTicketTemplates.find(
      (candidate) => candidate.id === "device-deployment",
    )!;

    expect(template).toMatchObject({
      name: "New device setup",
      version: 2,
      track: {
        name: "New device setup Track",
        version: 2,
      },
    });
    expect(template.track?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "eta", type: "date_time" }),
        expect.objectContaining({ id: "user", type: "text" }),
        expect.objectContaining({ id: "setup-type", type: "choice" }),
        expect.objectContaining({ id: "asset", type: "asset" }),
        expect.objectContaining({ id: "software", type: "text" }),
        expect.objectContaining({ id: "licensing", type: "text" }),
        expect.objectContaining({ id: "migration", type: "text" }),
        expect.objectContaining({ id: "accessories", type: "text" }),
        expect.objectContaining({ id: "handover", type: "checkbox" }),
      ]),
    );
  });
});

describe("closure guardrails", () => {
  it("blocks closure while mandatory Track items are unresolved", () => {
    const template = serviceTicketTemplates.find(
      (candidate) => candidate.id === "general-support",
    )!;
    const workflow = applyTicketTemplate({
      actorEmail: "simeon@egit.com.au",
      classification: {
        confidence: 1,
        reason: "Manual selection",
        source: "manual",
        templateId: template.id,
      },
      requestId: request.id,
      template,
    });

    expect(
      evaluateClosureGuardrails({
        disposition: "complete",
        solution: "Restored service and confirmed with the customer.",
        track: workflow.track,
        worklogDescription: "Repaired the workstation.",
        worklogMinutes: 30,
        workflow,
      }),
    ).toMatchObject({ canClose: false });
  });

  it("allows closure when mandatory items and the solution are complete", () => {
    const template = serviceTicketTemplates.find(
      (candidate) => candidate.id === "general-support",
    )!;
    let workflow = applyTicketTemplate({
      actorEmail: "simeon@egit.com.au",
      classification: {
        confidence: 1,
        reason: "Manual selection",
        source: "manual",
        templateId: template.id,
      },
      requestId: request.id,
      template,
    });
    for (const item of workflow.track!.items) {
      workflow = updateTrackItem(workflow, item.id, {
        actorEmail: "simeon@egit.com.au",
        status: "completed",
        value:
          item.type === "checkbox" || item.type === "approval"
            ? undefined
            : "Captured detail",
      });
    }

    expect(
      evaluateClosureGuardrails({
        disposition: "complete",
        solution: "Restored service and confirmed with the customer.",
        track: workflow.track,
        worklogDescription: "Repaired the workstation.",
        worklogMinutes: 30,
        workflow,
      }),
    ).toEqual({ blockers: [], canClose: true });
  });

  it("does not apply completion-only blockers to another valid outcome", () => {
    expect(
      evaluateClosureGuardrails({
        disposition: "return_to_queue",
        worklogDescription: "Investigated and need another visit.",
        worklogMinutes: 15,
      }),
    ).toEqual({ blockers: [], canClose: true });
  });
});

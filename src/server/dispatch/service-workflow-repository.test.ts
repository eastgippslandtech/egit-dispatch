import { describe, expect, it, vi } from "vitest";

import {
  applyTicketTemplate,
  serviceTicketTemplates,
} from "./service-workflow";
import { createPostgresRequestWorkflowRepository } from "./service-workflow-repository";

function workflow() {
  const template = serviceTicketTemplates[0];
  return applyTicketTemplate({
    actorEmail: "simeon@egit.com.au",
    classification: {
      confidence: 1,
      reason: "Dispatcher selected the template.",
      source: "manual",
      templateId: template.id,
    },
    now: "2026-08-04T01:00:00.000Z",
    requestId: "request-1",
    template,
  });
}

describe("request workflow repository", () => {
  it("returns a stored workflow snapshot", async () => {
    const stored = workflow();
    const sql = Object.assign(vi.fn().mockResolvedValue([{ workflow: stored }]), {
      json: (value: unknown) => value,
    });
    const repository = createPostgresRequestWorkflowRepository({ sql: sql as never });

    await expect(repository.get("request-1")).resolves.toEqual(stored);
  });

  it("stores the versioned workflow and an audit event", async () => {
    const stored = workflow();
    const transactionSql = Object.assign(vi.fn().mockResolvedValue([]), {
      json: (value: unknown) => value,
    });
    const sql = Object.assign(vi.fn(), {
      begin: vi.fn(async (callback: (tx: typeof transactionSql) => Promise<void>) =>
        callback(transactionSql),
      ),
      json: (value: unknown) => value,
    });
    const repository = createPostgresRequestWorkflowRepository({ sql: sql as never });

    await repository.save(stored, {
      action: "template_applied",
      actorEmail: "simeon@egit.com.au",
      details: { templateId: stored.templateId },
    });

    expect(sql.begin).toHaveBeenCalledOnce();
    expect(transactionSql).toHaveBeenCalledTimes(2);
  });
});

import { NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import {
  AUTO_CLASSIFICATION_CONFIDENCE,
  applyTicketTemplate,
  classifyTicketTemplate,
  serviceTicketTemplates,
  updateTrackItem,
  type TrackItemStatus,
} from "@/server/dispatch/service-workflow";
import { getConfiguredRequestWorkflowRepository } from "@/server/dispatch/service-workflow-repository";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const access = await approvedAccess();
  if (access instanceof NextResponse) return access;
  const repository = getConfiguredRequestWorkflowRepository();
  if (!repository) return json({ error: "Ticket workflows are unavailable." }, 503);
  const { requestId } = await params;
  return json({ workflow: await repository.get(requestId) }, 200);
}

export async function POST(request: Request, { params }: RouteContext) {
  const access = await approvedAccess();
  if (access instanceof NextResponse) return access;
  const repository = getConfiguredRequestWorkflowRepository();
  if (!repository) return json({ error: "Ticket workflows are unavailable." }, 503);
  const { requestId } = await params;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action === "apply_template") {
      const templateId = requiredString(body.templateId, "templateId");
      const template = serviceTicketTemplates.find((candidate) => candidate.id === templateId);
      if (!template) throw new Error("The selected ticket template is unavailable.");
      const existing = await repository.get(requestId);
      const automatic = body.automatic === true;
      const classification = automatic
        ? classifyTicketTemplate(asRequestSummary(body.request))
        : {
            confidence: 1,
            reason: "Dispatcher selected the template.",
            source: "manual" as const,
            templateId,
          };
      if (
        !classification ||
        classification.templateId !== templateId ||
        (automatic && classification.confidence < AUTO_CLASSIFICATION_CONFIDENCE)
      ) {
        throw new Error("This request does not meet the automatic classification threshold.");
      }
      const workflow = applyTicketTemplate({
        actorEmail: access.email,
        classification,
        requestId,
        template,
      });
      await repository.save(workflow, {
        action: existing ? "template_replaced" : "template_applied",
        actorEmail: access.email,
        details: {
          classification: classification.source,
          confidence: classification.confidence,
          previousTemplateId: existing?.templateId,
          templateId,
        },
      });
      return json({ workflow }, 200);
    }

    if (body.action === "update_track_item") {
      const existing = await repository.get(requestId);
      if (!existing) throw new Error("Apply a ticket template before updating its Track.");
      const itemId = requiredString(body.itemId, "itemId");
      const status = trackStatus(body.status);
      const workflow = updateTrackItem(existing, itemId, {
        actorEmail: access.email,
        notApplicableReason: optionalString(body.notApplicableReason),
        status,
        value: optionalString(body.value),
      });
      await repository.save(workflow, {
        action: "track_item_updated",
        actorEmail: access.email,
        details: { itemId, status },
      });
      return json({ workflow }, 200);
    }

    throw new Error("The workflow action is invalid.");
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Ticket workflow update failed." },
      400,
    );
  }
}

async function approvedAccess() {
  const access = await getCommandCentreAccess();
  if (access.status === "unauthenticated") {
    return json({ error: "Authentication required." }, 401);
  }
  if (!isApprovedStaffAccess(access)) {
    return json({ error: "Access not approved." }, 403);
  }
  return access;
}

function asRequestSummary(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    category: optionalString(input.category),
    item: optionalString(input.item),
    notes: optionalString(input.notes),
    subcategory: optionalString(input.subcategory),
    subject: optionalString(input.subject) ?? "",
  };
}

function trackStatus(value: unknown): TrackItemStatus {
  if (value === "completed" || value === "not_applicable" || value === "pending") {
    return value;
  }
  throw new Error("The Track item status is invalid.");
}

function requiredString(value: unknown, label: string) {
  const result = optionalString(value);
  if (!result) throw new Error(`${label} is required.`);
  return result;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

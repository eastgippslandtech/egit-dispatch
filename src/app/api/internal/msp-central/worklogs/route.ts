import { after, NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { readDispatchConfig } from "@/server/dispatch/env";
import { evaluateClosureGuardrails } from "@/server/dispatch/service-workflow";
import { getConfiguredRequestWorkflowRepository } from "@/server/dispatch/service-workflow-repository";
import { fingerprintPayload } from "@/server/integrations/fingerprint";
import { integrationRouteErrorStatus } from "@/server/integrations/http";
import { worklogOperation } from "@/server/integrations/operations";
import { wakeIntegrationProcessor } from "@/server/integrations/wake";
import { createMspCentralClient } from "@/server/msp-central/client";
import { validateWorklogDispositionCommand } from "@/server/worklogs/disposition";
import { createPostgresWorklogMigrationCoordinator } from "@/server/worklogs/migration";
import { createPostgresWorklogOutcomeStore } from "@/server/worklogs/outcome-store";
import { resolveMspCentralWorklogOwner } from "@/server/worklogs/owner";

export async function POST(request: Request) {
  const access = await getCommandCentreAccess();
  if (access.status === "unauthenticated") {
    return json({ error: "Authentication required." }, 401);
  }
  if (!isApprovedStaffAccess(access)) {
    return json({ error: "Access not approved." }, 403);
  }

  try {
    const command = validateWorklogDispositionCommand(await request.json());
    const config = readDispatchConfig();
    if (command.disposition === "complete") {
      const workflowRepository = getConfiguredRequestWorkflowRepository(
        config.databaseUrl,
      );
      const workflow = workflowRepository
        ? await workflowRepository.get(command.requestId)
        : null;
      const guardrails = evaluateClosureGuardrails({
        disposition: command.disposition,
        solution: command.solution,
        track: workflow?.track,
        workflow,
        worklogDescription: command.description,
        worklogMinutes: command.durationMinutes,
      });
      if (!guardrails.canClose) {
        return NextResponse.json(
          { blockers: guardrails.blockers, error: "Closure requirements are not complete.", ok: false },
          { headers: { "Cache-Control": "no-store" }, status: 409 },
        );
      }
    }
    const mspClient = createMspCentralClient(config);
    const owner = await resolveMspCentralWorklogOwner({
      email: access.email,
      mspClient,
    });
    const outcomeStore = createPostgresWorklogOutcomeStore({
      databaseUrl: config.databaseUrl,
    });
    const storedAssignments = await outcomeStore.listCalendarAssignments({
      requestId: command.requestId,
    });
    const calendarAssignments = storedAssignments.map((assignment) => ({
      ...assignment,
      technicianId:
        command.currentBooking?.eventId === assignment.eventId &&
        command.currentBooking.userPrincipalName === assignment.userPrincipalName
          ? command.currentBooking.technicianId ?? calendarIdentity(assignment)
          : calendarIdentity(assignment),
    }));
    const coordinator = createPostgresWorklogMigrationCoordinator({
      databaseUrl: config.databaseUrl,
    });
    const result = await coordinator.enqueue({
      command,
      createOperation: (queuedCommand, worklogAlreadySaved) =>
        worklogOperation({
          actorEmail: access.email,
          calendarAssignments,
          command: queuedCommand,
          ownerId: owner.id,
          worklogAlreadySaved,
        }),
    });
    const operationId =
      result.kind === "operation" ? result.operation.id : result.operationId;
    const status =
      result.kind === "operation" ? result.operation.state : result.status;
    if (result.kind === "operation") {
      after(() => bestEffortWake(operationId));
    }

    return json(
      {
        idempotencyKey: command.idempotencyKey,
        ok: true,
        operationId,
        status,
      },
      status === "synced" ? 200 : 202,
    );
  } catch (error) {
    console.error("MSP Central Work Log queue failed", error);
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "MSP Central Work Log could not be queued.",
        ok: false,
      },
      integrationRouteErrorStatus(error),
    );
  }
}

function calendarIdentity(input: {
  eventId: string;
  userPrincipalName: string;
}) {
  return `calendar:${fingerprintPayload(input).slice(0, 24)}`;
}

async function bestEffortWake(operationId: string) {
  try {
    await wakeIntegrationProcessor(operationId);
  } catch (error) {
    console.warn("Work Log remains durably queued after wake-up failure.", {
      message: error instanceof Error ? error.message : "Unknown wake-up error.",
      operationId,
    });
  }
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

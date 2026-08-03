import { after, NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { readDispatchConfig } from "@/server/dispatch/env";
import { fingerprintPayload } from "@/server/integrations/fingerprint";
import { integrationRouteErrorStatus } from "@/server/integrations/http";
import { worklogOperation } from "@/server/integrations/operations";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { wakeIntegrationProcessor } from "@/server/integrations/wake";
import { createMspCentralClient } from "@/server/msp-central/client";
import {
  validateWorklogDispositionCommand,
  type WorklogDispositionCommand,
} from "@/server/worklogs/disposition";
import { createPostgresWorklogOutcomeStore } from "@/server/worklogs/outcome-store";
import { resolveMspCentralWorklogOwner } from "@/server/worklogs/owner";
import { createPostgresWorklogDispositionRepository } from "@/server/worklogs/repository";

export async function POST(request: Request) {
  const access = await getCommandCentreAccess();
  if (access.status === "unauthenticated") {
    return json({ error: "Authentication required." }, 401);
  }
  if (!isApprovedStaffAccess(access)) {
    return json({ error: "Access not approved." }, 403);
  }

  try {
    const submitted = validateWorklogDispositionCommand(await request.json());
    const config = readDispatchConfig();
    const legacyRepository = createPostgresWorklogDispositionRepository({
      databaseUrl: config.databaseUrl,
    });
    const legacy = await legacyRepository.find(submitted.idempotencyKey);
    const command = resolveLegacyCommand(legacy?.command, submitted);

    if (legacy?.state === "completed") {
      return json(
        {
          idempotencyKey: command.idempotencyKey,
          ok: true,
          operationId: `legacy:${command.idempotencyKey}`,
          status: "synced",
        },
        200,
      );
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
    const repository = createPostgresIntegrationRepository({
      databaseUrl: config.databaseUrl,
    });
    const { operation } = await repository.enqueue(
      worklogOperation({
        actorEmail: access.email,
        calendarAssignments,
        command,
        ownerId: owner.id,
        worklogAlreadySaved:
          legacy?.state === "worklog_saved" ||
          legacy?.state === "recovery_required",
      }),
    );
    after(() => bestEffortWake(operation.id));

    return json(
      {
        idempotencyKey: command.idempotencyKey,
        ok: true,
        operationId: operation.id,
        status: operation.state,
      },
      202,
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

function resolveLegacyCommand(
  legacy: WorklogDispositionCommand | undefined,
  submitted: WorklogDispositionCommand,
) {
  if (!legacy) return submitted;
  if (
    fingerprintPayload(jsonCompatible(legacy)) !==
    fingerprintPayload(jsonCompatible(submitted))
  ) {
    throw new Error(
      "This Work Log idempotency key was already used for different work.",
    );
  }
  return legacy;
}

function jsonCompatible(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
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

import { NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { readDispatchConfig } from "@/server/dispatch/env";
import { createGraphClient } from "@/server/graph/client";
import { createMspCentralClient } from "@/server/msp-central/client";
import { validateWorklogDispositionCommand } from "@/server/worklogs/disposition";
import { createPostgresWorklogOutcomeStore } from "@/server/worklogs/outcome-store";
import { resolveMspCentralWorklogOwner } from "@/server/worklogs/owner";
import { createWorklogDispositionProcessor } from "@/server/worklogs/processor";
import { createPostgresWorklogDispositionRepository } from "@/server/worklogs/repository";
import { createWorklogDispositionRuntime } from "@/server/worklogs/runtime";

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
    const mspClient = createMspCentralClient(config);
    const worklogOwner = await resolveMspCentralWorklogOwner({
      email: access.email,
      mspClient,
    });
    const runtime = createWorklogDispositionRuntime({
      graphClient: createGraphClient(config.microsoft),
      mspClient,
      outcomeStore: createPostgresWorklogOutcomeStore({
        databaseUrl: config.databaseUrl,
      }),
      worklogOwner,
    });
    const processor = createWorklogDispositionProcessor({
      applyDisposition: runtime.applyDisposition,
      repository: createPostgresWorklogDispositionRepository({
        databaseUrl: config.databaseUrl,
      }),
      saveWorklog: runtime.saveWorklog,
    });
    const result = await processor.process(command);

    return json(
      { ok: result.status === "completed", ...result },
      result.status === "completed" ? 200 : 202,
    );
  } catch (error) {
    console.error("MSP Central Work Log route failed", error);
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "MSP Central Work Log save failed.",
        ok: false,
      },
      400,
    );
  }
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

import { NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { readDispatchConfig } from "@/server/dispatch/env";
import { createMspCentralClient } from "@/server/msp-central/client";
import type { Priority } from "@/server/dispatch/types";

export const dynamic = "force-dynamic";

const priorities = new Set<Priority>(["Critical", "High", "Medium", "Low"]);

export async function POST(request: Request) {
  const access = await getCommandCentreAccess();
  if (access.status === "unauthenticated") {
    return json({ error: "Authentication required." }, 401);
  }
  if (!isApprovedStaffAccess(access)) {
    return json({ error: "Access not approved." }, 403);
  }

  try {
    const input = (await request.json()) as {
      customer?: string;
      description?: string;
      priority?: Priority;
      requesterEmail?: string;
      site?: string;
      subject?: string;
    };
    const subject = input.subject?.trim() ?? "";
    const priority = priorities.has(input.priority ?? "Medium")
      ? (input.priority ?? "Medium")
      : "Medium";
    if (!subject) return json({ error: "Subject is required." }, 400);

    const client = createMspCentralClient(readDispatchConfig());
    if (!client.createRequest) {
      return json({ error: "MSP Central request creation is unavailable." }, 503);
    }
    const created = await client.createRequest({
      customer: input.customer?.trim(),
      description: input.description?.trim(),
      priority,
      requesterEmail: input.requesterEmail?.trim(),
      site: input.site?.trim(),
      subject,
    });
    return json({ ok: true, request: created }, 201);
  } catch (error) {
    console.error("MSP Central request creation failed", error);
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "MSP Central request could not be created.",
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

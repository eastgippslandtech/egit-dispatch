import { NextResponse } from "next/server";

import { readDispatchConfig } from "@/server/dispatch/env";
import { createMspCentralClient } from "@/server/msp-central/client";
import { processTechnicianNotifications } from "@/server/notifications/poll";
import { getConfiguredNotificationRepository } from "@/server/notifications/repository";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (
    !cronSecret ||
    request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = readDispatchConfig();
  const repository = getConfiguredNotificationRepository();
  if (config.dispatchDataSource !== "msp-central" || !repository) {
    return NextResponse.json({
      reason: "Live MSP Central notifications are not configured.",
      skipped: true,
    });
  }

  try {
    const result = await processTechnicianNotifications({
      client: createMspCentralClient(config),
      repository,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Technician notification poll failed", {
      message: error instanceof Error ? error.message : "Unknown poll error",
    });
    return NextResponse.json(
      { error: "Technician notification poll failed." },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";

import { cronAuthorized } from "@/server/yeastar/route-auth";
import { configureYeastarScheduler } from "@/server/yeastar/scheduler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const secret =
    process.env.INTEGRATION_CRON_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim();
  const baseUrl =
    process.env.APP_BASE_URL?.trim() ||
    process.env.AUTH_URL?.trim() ||
    "https://command.egit.com.au";
  if (!databaseUrl || !secret) {
    return NextResponse.json(
      { error: "Database or scheduler secret is not configured." },
      { status: 503 },
    );
  }
  return NextResponse.json(
    await configureYeastarScheduler({ baseUrl, databaseUrl, secret }),
  );
}

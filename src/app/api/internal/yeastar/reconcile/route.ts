import { NextResponse } from "next/server";

import { YeastarClient } from "@/server/yeastar/client";
import { readYeastarConfig } from "@/server/yeastar/config";
import { reconcileYeastarCalls } from "@/server/yeastar/ingestion";
import { getConfiguredYeastarRepository } from "@/server/yeastar/repository";
import { cronAuthorized } from "@/server/yeastar/route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const config = readYeastarConfig();
  const repository = getConfiguredYeastarRepository();
  if (!config || !repository) {
    return NextResponse.json({ configured: false, queued: 0 });
  }
  const now = new Date();
  const from = new Date(now.getTime() - 10 * 60_000);
  const client = new YeastarClient({
    config,
    tokenStore: repository.tokenStore(),
  });
  return NextResponse.json(
    await reconcileYeastarCalls({
      client,
      from: formatPbxDate(from),
      repository,
      to: formatPbxDate(now),
    }),
  );
}

function formatPbxDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: "Australia/Melbourne",
    year: "numeric",
  }).formatToParts(value);
  const read = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}/${read("month")}/${read("day")} ${read("hour")}:${read("minute")}:${read("second")}`;
}

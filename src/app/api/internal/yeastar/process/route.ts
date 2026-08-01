import { NextResponse } from "next/server";

import { YeastarClient } from "@/server/yeastar/client";
import { readYeastarConfig } from "@/server/yeastar/config";
import { processPendingYeastarEvents } from "@/server/yeastar/ingestion";
import { getConfiguredYeastarRepository } from "@/server/yeastar/repository";
import { cronAuthorized } from "@/server/yeastar/route-auth";
import { ZohoCrmClient } from "@/server/zoho-crm/client";
import { readZohoCrmConfig } from "@/server/zoho-crm/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const config = readYeastarConfig();
  const repository = getConfiguredYeastarRepository();
  if (!config || !repository) {
    return NextResponse.json({ configured: false, processed: 0 });
  }
  const client = new YeastarClient({
    config,
    tokenStore: repository.tokenStore(),
  });
  const crmConfig = readZohoCrmConfig();
  return NextResponse.json(
    await processPendingYeastarEvents({
      client,
      crmClient: crmConfig ? new ZohoCrmClient(crmConfig) : undefined,
      repository,
    }),
  );
}

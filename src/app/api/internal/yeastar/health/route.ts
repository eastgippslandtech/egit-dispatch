import { NextResponse } from "next/server";

import { readYeastarConfig, yeastarWebhookConfigured } from "@/server/yeastar/config";
import { getConfiguredYeastarRepository } from "@/server/yeastar/repository";
import { staffRouteAccess } from "@/server/yeastar/route-auth";
import { readZohoCrmConfig } from "@/server/zoho-crm/config";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await staffRouteAccess())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return NextResponse.json({
    databaseConfigured: Boolean(getConfiguredYeastarRepository()),
    yeastarApiConfigured: Boolean(readYeastarConfig()),
    yeastarWebhookConfigured: yeastarWebhookConfigured(),
    zohoCrmConfigured: Boolean(readZohoCrmConfig()),
  });
}

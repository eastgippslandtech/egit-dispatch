import { integrationJson } from "@/server/integrations/http";
import { configureIntegrationScheduler } from "@/server/integrations/scheduler";
import { cronAuthorized } from "@/server/yeastar/route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!cronAuthorized(request)) {
    return integrationJson({ error: "Unauthorized." }, { status: 401 });
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
    return integrationJson(
      { error: "Integration scheduler is not configured." },
      { status: 503 },
    );
  }

  try {
    const endpointUrl = new URL("/api/internal/integrations/process", baseUrl).toString();
    return integrationJson(
      await configureIntegrationScheduler({
        databaseUrl,
        endpointUrl,
        secret,
      }),
    );
  } catch {
    return integrationJson(
      { error: "Integration scheduler could not be configured." },
      { status: 503 },
    );
  }
}

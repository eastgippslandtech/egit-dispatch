import { integrationJson } from "@/server/integrations/http";
import { createConfiguredIntegrationWorker } from "@/server/integrations/runtime";
import { cronAuthorized } from "@/server/yeastar/route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!cronAuthorized(request)) {
    return integrationJson({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const limit = boundedLimit(body);
    const { processor, repository } = createConfiguredIntegrationWorker();
    const summary = await processor.processDue({ limit });
    const remainingDue = await repository.countDueSteps();
    return integrationJson({
      processingErrors: summary.processingErrors,
      claimed: summary.claimed,
      remainingDue,
      retrying: summary.retrying,
      reviewRequired: summary.reviewRequired,
      succeeded: summary.succeeded,
    });
  } catch {
    return integrationJson(
      { error: "Integration processing is temporarily unavailable." },
      { status: 503 },
    );
  }
}

function boundedLimit(body: unknown) {
  const value =
    body && typeof body === "object" ? Number(Reflect.get(body, "limit")) : 10;
  if (!Number.isFinite(value)) return 10;
  return Math.min(25, Math.max(1, Math.trunc(value)));
}

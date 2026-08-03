export async function wakeIntegrationProcessor(operationId?: string) {
  const baseUrl =
    process.env.APP_BASE_URL?.trim() ||
    process.env.AUTH_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim();
  const secret = process.env.INTEGRATION_CRON_SECRET?.trim();

  if (!baseUrl || !secret) return;

  const response = await fetch(
    new URL("/api/internal/integrations/process", baseUrl),
    {
      body: JSON.stringify(operationId ? { operationId } : {}),
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new Error(`Integration processor wake-up failed (${response.status}).`);
  }
}

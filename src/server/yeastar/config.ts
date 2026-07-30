export type YeastarConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  userAgent: string;
};

export function readYeastarConfig(
  env: Record<string, string | undefined> = process.env,
): YeastarConfig | null {
  const baseUrl = env.YEASTAR_BASE_URL?.trim();
  const clientId = env.YEASTAR_CLIENT_ID?.trim();
  const clientSecret = env.YEASTAR_CLIENT_SECRET?.trim();
  if (!baseUrl || !clientId || !clientSecret) return null;

  return {
    baseUrl: new URL(baseUrl).origin,
    clientId,
    clientSecret,
    userAgent:
      env.YEASTAR_API_USER_AGENT?.trim() || "EGIT-Command-Centre/1.0",
  };
}

export function yeastarWebhookConfigured(
  env: Record<string, string | undefined> = process.env,
) {
  return Boolean(env.YEASTAR_WEBHOOK_SECRET?.trim());
}

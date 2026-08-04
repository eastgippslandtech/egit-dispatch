import { MspCentralConfigurationError } from "./errors";

const MSP_OAUTH_SCOPES = [
  "SDPOnDemand.requests.ALL",
  "SDPOnDemand.setup.READ",
  "SDPOnDemand.general.READ",
];

type AuthorizationUrlInput = {
  accountsUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
};

type ExchangeCodeInput = {
  accountsUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  fetchImpl?: typeof fetch;
  redirectUri: string;
};

export function buildMspCentralAuthorizationUrl({
  accountsUrl,
  clientId,
  redirectUri,
  state,
}: AuthorizationUrlInput) {
  const url = new URL("oauth/v2/auth", withTrailingSlash(accountsUrl));
  url.search = new URLSearchParams({
    access_type: "offline",
    client_id: clientId,
    prompt: "consent",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: MSP_OAUTH_SCOPES.join(","),
    state,
  }).toString();
  return url.toString();
}

export async function exchangeMspCentralAuthorizationCode({
  accountsUrl,
  clientId,
  clientSecret,
  code,
  fetchImpl = fetch,
  redirectUri,
}: ExchangeCodeInput) {
  const tokenUrl = new URL("oauth/v2/token", withTrailingSlash(accountsUrl));
  const response = await fetchImpl(tokenUrl.toString(), {
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json()) as {
    access_token?: string;
    api_domain?: string;
    error?: string;
    expires_in?: number | string;
    refresh_token?: string;
  };

  if (!response.ok || payload.error || !payload.access_token || !payload.refresh_token) {
    throw new MspCentralConfigurationError(
      payload.error
        ? `MSP Central OAuth authorisation failed (${payload.error}).`
        : "MSP Central OAuth authorisation response was incomplete.",
    );
  }

  return {
    accessToken: payload.access_token,
    apiDomain: payload.api_domain?.replace(/\/+$/, ""),
    expiresInSeconds: positiveNumber(payload.expires_in, 3600),
    refreshToken: payload.refresh_token,
  };
}

function positiveNumber(value: number | string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function withTrailingSlash(value: string) {
  return `${value.replace(/\/+$/, "")}/`;
}

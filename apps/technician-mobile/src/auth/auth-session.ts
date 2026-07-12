export const MOBILE_AUTH_REDIRECT_URI = "egitcommand://auth/callback";

export function mobileZohoCallbackUriFor(mobileApiBaseUrl: string) {
  return `${mobileApiBaseUrl.replace(/\/+$/, "")}/auth/callback`;
}

export interface ZohoAuthorizationRequestInput {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
}

export interface ZohoAuthorizationRequest {
  accessType: "offline";
  authorizationEndpoint: string;
  clientId: string;
  codeChallengeMethod: "S256";
  prompt: "consent";
  redirectUri: string;
  responseType: "code";
  scopes: string[];
  state: string;
  usePKCE: true;
}

export function buildZohoAuthorizationRequest({
  clientId,
  redirectUri,
  scopes,
  state,
}: ZohoAuthorizationRequestInput): ZohoAuthorizationRequest {
  return {
    accessType: "offline",
    authorizationEndpoint: "https://accounts.zoho.com.au/oauth/v2/auth",
    clientId,
    codeChallengeMethod: "S256",
    prompt: "consent",
    redirectUri,
    responseType: "code",
    scopes,
    state,
    usePKCE: true,
  };
}

export function buildAuthExchangePayload({
  code,
  codeVerifier,
  redirectUri,
}: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}) {
  return {
    code,
    codeVerifier,
    redirectUri,
  };
}

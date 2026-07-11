export interface ZohoAuthorizationRequestInput {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
}

export interface ZohoAuthorizationRequest {
  authorizationEndpoint: string;
  clientId: string;
  codeChallengeMethod: "S256";
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
    authorizationEndpoint: "https://accounts.zoho.com.au/oauth/v2/auth",
    clientId,
    codeChallengeMethod: "S256",
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

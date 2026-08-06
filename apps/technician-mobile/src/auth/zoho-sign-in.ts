import * as WebBrowser from "expo-web-browser";

import type { MobileStaff } from "../contracts/mobile";
import { getMobileRuntimeConfig } from "../config/runtime";
import { MOBILE_STAFF_FIXTURES } from "../testing/fixtures";

import {
  MOBILE_AUTH_REDIRECT_URI,
  buildAuthExchangePayload,
  buildZohoAuthorizationRequest,
  mobileZohoCallbackUriFor,
} from "./auth-session";
import type { MobileSession } from "./session-store";
import { saveMobileSession } from "./session-store";

WebBrowser.maybeCompleteAuthSession();

export interface ZohoSignInResult {
  session: MobileSession;
  staff: MobileStaff;
}

type MobileAuthEnvelope = {
  data: {
    email: string;
    session: {
      accessToken: string;
      expiresAt: string;
      refreshToken: string;
    };
    staff: MobileStaff;
    staffId: string;
    status: "approved";
  };
};

export async function performZohoSignIn({
  fetcher = fetch,
}: {
  fetcher?: typeof fetch;
} = {}): Promise<ZohoSignInResult> {
  const config = getMobileRuntimeConfig();
  if (config.authMode === "mock") {
    return createLocalMockSignIn();
  }
  if (!config.zohoClientId) {
    throw new Error("Zoho sign-in is not configured for this build.");
  }

  const AuthSession = await import("expo-auth-session");
  const zohoRedirectUri = mobileZohoCallbackUriFor(config.mobileApiBaseUrl);
  const zohoRequest = buildZohoAuthorizationRequest({
    clientId: config.zohoClientId,
    redirectUri: zohoRedirectUri,
    scopes: ["AaaServer.profile.READ"],
    state: createState(),
  });
  const request = new AuthSession.AuthRequest({
    clientId: zohoRequest.clientId,
    codeChallengeMethod: AuthSession.CodeChallengeMethod.S256,
    extraParams: {
      access_type: zohoRequest.accessType,
      ...(zohoRequest.prompt ? { prompt: zohoRequest.prompt } : {}),
    },
    redirectUri: zohoRequest.redirectUri,
    responseType: AuthSession.ResponseType.Code,
    scopes: zohoRequest.scopes,
    state: zohoRequest.state,
    usePKCE: zohoRequest.usePKCE,
  });
  const authUrl = await request.makeAuthUrlAsync({
    authorizationEndpoint: zohoRequest.authorizationEndpoint,
  });
  const browserResult = await WebBrowser.openAuthSessionAsync(
    authUrl,
    MOBILE_AUTH_REDIRECT_URI,
    { preferEphemeralSession: true },
  );
  if (browserResult.type !== "success") {
    throw new Error("Zoho sign-in was cancelled.");
  }

  const result = request.parseReturnUrl(browserResult.url);

  if (result.type !== "success") {
    throw new Error("Zoho sign-in was cancelled.");
  }

  const code = result.params.code;
  if (!code || !request.codeVerifier) {
    throw new Error("Zoho did not return a valid authorization code.");
  }

  const response = await fetcher(`${config.mobileApiBaseUrl}/auth/exchange`, {
    body: JSON.stringify({
      ...buildAuthExchangePayload({
        code,
        codeVerifier: request.codeVerifier,
        redirectUri: zohoRedirectUri,
      }),
      accountsServer: result.params["accounts-server"],
    }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("This Zoho account is not enabled for Command Centre.");
  }

  const envelope = (await response.json()) as MobileAuthEnvelope;
  const session: MobileSession = {
    ...envelope.data.session,
    staffEmail: envelope.data.staff.email,
  };
  await saveMobileSession(session);

  return {
    session,
    staff: envelope.data.staff,
  };
}

function createState(): string {
  return Math.random().toString(36).slice(2, 14);
}

function createLocalMockSignIn(): ZohoSignInResult {
  const staff = MOBILE_STAFF_FIXTURES.find(
    (candidate) => candidate.email === "riley@egit.com.au",
  );
  if (!staff) {
    throw new Error("The local Riley mock staff profile is missing.");
  }

  return {
    session: {
      accessToken: "local-mock-access-staff-riley",
      expiresAt: "2030-01-01T00:00:00.000Z",
      refreshToken: "local-mock-refresh-staff-riley",
      staffEmail: staff.email,
    },
    staff,
  };
}

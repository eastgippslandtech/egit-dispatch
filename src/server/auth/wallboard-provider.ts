import Credentials from "next-auth/providers/credentials";
import type { CredentialsConfig } from "next-auth/providers/credentials";

import { authenticateWallboardLogin } from "./wallboard-login";

type WallboardProviderOptions = {
  authenticate?: typeof authenticateWallboardLogin;
};

export function createWallboardProvider({
  authenticate = authenticateWallboardLogin,
}: WallboardProviderOptions = {}) {
  const options: CredentialsConfig<{
    password: { label: string; type: "password" };
    username: { label: string; type: "text" };
  }> = {
    id: "wallboard",
    name: "Wallboard",
    type: "credentials",
    credentials: {
      username: { label: "Username", type: "text" },
      password: { label: "Password", type: "password" },
    },
    authorize(credentials, request) {
      return authenticate({
        clientAddress: clientAddressFromHeaders(request.headers),
        password:
          typeof credentials?.password === "string" ? credentials.password : "",
        username:
          typeof credentials?.username === "string" ? credentials.username : "",
      });
    },
  };

  return { ...Credentials(options), ...options };
}

function clientAddressFromHeaders(headers: Headers) {
  const forwardedAddress =
    headers.get("x-vercel-forwarded-for") ??
    headers.get("x-forwarded-for") ??
    "";

  return forwardedAddress.split(",")[0]?.trim() ?? "";
}

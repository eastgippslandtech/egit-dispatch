import { isAllowedAuthEmail } from "./allowlist";

type AuthEnv = Record<string, string | undefined> & {
  ALLOWED_AUTH_EMAILS?: string;
  DISABLE_AUTH?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
};

type MinimalSession = {
  user?: {
    email?: string | null;
    name?: string | null;
  };
} | null;

export type CommandCentreAccess =
  | {
      status: "approved";
      email: string;
      name?: string;
      authDisabled?: boolean;
    }
  | {
      status: "not-approved";
      email: string;
      name?: string;
    }
  | {
      status: "unauthenticated";
    };

export function isAuthDisabled(env: AuthEnv = process.env) {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(
    (env.DISABLE_AUTH ?? "").trim().toLowerCase(),
  );
}

export function commandCentreAccessFromSession(
  session: MinimalSession,
  env: AuthEnv = process.env,
): CommandCentreAccess {
  if (isAuthDisabled(env)) {
    return {
      status: "approved",
      email: "build-mode@egit.local",
      name: "Build Mode",
      authDisabled: true,
    };
  }

  const email = session?.user?.email?.trim().toLowerCase();
  const name = session?.user?.name?.trim() || undefined;

  if (!email) {
    return { status: "unauthenticated" };
  }

  if (!isAllowedAuthEmail(email, env.ALLOWED_AUTH_EMAILS)) {
    return { status: "not-approved", email, name };
  }

  return { status: "approved", email, name };
}

export async function getCommandCentreAccess() {
  if (isAuthDisabled()) {
    return commandCentreAccessFromSession(null);
  }

  const { auth } = await import("@/auth");

  return commandCentreAccessFromSession(await auth());
}

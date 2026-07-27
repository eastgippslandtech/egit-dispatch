import { isAllowedAuthEmail } from "./allowlist";

type AuthEnv = Record<string, string | undefined> & {
  ALLOWED_AUTH_EMAILS?: string;
  DISABLE_AUTH?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
};

type MinimalSession = {
  accessLevel?: "staff" | "wallboard";
  user?: {
    email?: string | null;
    name?: string | null;
  };
} | null;

export type ApprovedStaffAccess = {
  status: "approved";
  accessLevel?: "staff";
  email: string;
  name?: string;
  authDisabled?: boolean;
};

type NotApprovedAccess = {
  status: "not-approved";
  email: string;
  name?: string;
};

type UnauthenticatedAccess = {
  status: "unauthenticated";
};

type WallboardOnlyAccess = {
  status: "wallboard-only";
  name?: string;
};

type StaffAccess =
  | ApprovedStaffAccess
  | NotApprovedAccess
  | UnauthenticatedAccess;

export type CommandCentreAccess = StaffAccess | WallboardOnlyAccess;

export type WallboardAccess =
  | (ApprovedStaffAccess & { accessLevel: "staff" })
  | {
      status: "approved";
      accessLevel: "wallboard";
      name?: string;
    }
  | NotApprovedAccess
  | UnauthenticatedAccess;

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
  const name = session?.user?.name?.trim() || undefined;
  if (!isAuthDisabled(env) && session?.accessLevel === "wallboard") {
    return { status: "wallboard-only", name };
  }

  return staffAccessFromSession(session, env);
}

export function wallboardAccessFromSession(
  session: MinimalSession,
  env: AuthEnv = process.env,
): WallboardAccess {
  if (!isAuthDisabled(env) && session?.accessLevel === "wallboard") {
    return {
      status: "approved",
      accessLevel: "wallboard",
      name: session.user?.name?.trim() || undefined,
    };
  }

  const access = staffAccessFromSession(session, env);
  if (access.status !== "approved") {
    return access;
  }

  return { ...access, accessLevel: "staff" };
}

function staffAccessFromSession(
  session: MinimalSession,
  env: AuthEnv,
): StaffAccess {
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

export function isApprovedStaffAccess(
  access: CommandCentreAccess | WallboardAccess,
): access is ApprovedStaffAccess {
  return (
    access.status === "approved" &&
    access.accessLevel !== "wallboard" &&
    "email" in access
  );
}

export async function getCommandCentreAccess() {
  if (isAuthDisabled()) {
    return commandCentreAccessFromSession(null);
  }

  const { auth } = await import("@/auth");

  return commandCentreAccessFromSession(await auth());
}

export async function getWallboardAccess() {
  if (isAuthDisabled()) {
    return wallboardAccessFromSession(null);
  }

  const { auth } = await import("@/auth");

  return wallboardAccessFromSession(await auth());
}

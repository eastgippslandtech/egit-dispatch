import { createHmac } from "node:crypto";

import {
  createPostgresWallboardLoginAttemptRepository,
  type WallboardLoginAttemptRepository,
} from "./wallboard-login-attempts";
import { verifyWallboardPassword } from "./wallboard-password";

type WallboardLoginEnvironment = {
  [key: string]: string | undefined;
  AUTH_SECRET?: string;
  DATABASE_URL?: string;
  NEXTAUTH_SECRET?: string;
  WALLBOARD_LOCAL_PASSWORD_HASH?: string;
  WALLBOARD_LOCAL_USERNAME?: string;
};

type WallboardLoginInput = {
  clientAddress: string;
  password: string;
  username: string;
};

type WallboardLoginDependencies = {
  attemptRepository?: WallboardLoginAttemptRepository;
  env?: WallboardLoginEnvironment;
  now?: () => Date;
};

const WALLBOARD_USER = {
  id: "wallboard-local",
  name: "Command Centre Wallboard",
};

export function isWallboardLoginConfigured(
  env: WallboardLoginEnvironment = process.env,
) {
  return Boolean(
    authSecretFor(env) &&
      env.DATABASE_URL?.trim() &&
      env.WALLBOARD_LOCAL_PASSWORD_HASH?.trim() &&
      env.WALLBOARD_LOCAL_USERNAME?.trim(),
  );
}

export async function authenticateWallboardLogin(
  input: WallboardLoginInput,
  {
    attemptRepository,
    env = process.env,
    now = () => new Date(),
  }: WallboardLoginDependencies = {},
) {
  const passwordMatches = await verifyWallboardPassword(
    input.password,
    env.WALLBOARD_LOCAL_PASSWORD_HASH ?? "",
  );
  if (!isWallboardLoginConfigured(env)) {
    return null;
  }

  const authSecret = authSecretFor(env)!;
  const normalizedUsername = normalizeUsername(input.username);
  const repository =
    attemptRepository ??
    createPostgresWallboardLoginAttemptRepository({
      databaseUrl: env.DATABASE_URL!,
    });
  const attemptKey = createHmac("sha256", authSecret)
    .update(`${normalizedUsername}\0${input.clientAddress}`)
    .digest("base64url");

  if (await repository.isBlocked(attemptKey, now())) {
    return null;
  }

  const usernameMatches =
    normalizedUsername === normalizeUsername(env.WALLBOARD_LOCAL_USERNAME!);
  if (!usernameMatches || !passwordMatches) {
    await repository.recordFailure(attemptKey, now());
    return null;
  }

  await repository.clear(attemptKey);
  return WALLBOARD_USER;
}

function authSecretFor(env: WallboardLoginEnvironment) {
  return env.AUTH_SECRET?.trim() || env.NEXTAUTH_SECRET?.trim();
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

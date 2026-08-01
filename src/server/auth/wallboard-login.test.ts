import { describe, expect, it } from "vitest";

import {
  createWallboardLoginAttemptRepository,
  type WallboardLoginAttempt,
  type WallboardLoginAttemptStore,
} from "./wallboard-login-attempts";
import {
  authenticateWallboardLogin,
  isWallboardLoginConfigured,
} from "./wallboard-login";
import { hashWallboardPassword } from "./wallboard-password";

const now = new Date("2026-07-27T00:15:00.000Z");

function createMemoryAttemptRepository() {
  const attempts: WallboardLoginAttempt[] = [];
  const store: WallboardLoginAttemptStore = {
    async countRecent(attemptKey, since) {
      return attempts.filter(
        (attempt) =>
          attempt.attemptKey === attemptKey && attempt.failedAt >= since,
      ).length;
    },
    async deleteByKey(attemptKey) {
      for (let index = attempts.length - 1; index >= 0; index -= 1) {
        if (attempts[index].attemptKey === attemptKey) {
          attempts.splice(index, 1);
        }
      }
    },
    async deleteOlderThan(cutoff) {
      for (let index = attempts.length - 1; index >= 0; index -= 1) {
        if (attempts[index].failedAt < cutoff) {
          attempts.splice(index, 1);
        }
      }
    },
    async insert(attempt) {
      attempts.push(attempt);
    },
  };

  return {
    attemptRepository: createWallboardLoginAttemptRepository(store),
    attempts,
  };
}

async function configuredEnv() {
  return {
    AUTH_SECRET: "test-auth-secret",
    DATABASE_URL: "postgresql://example",
    WALLBOARD_LOCAL_PASSWORD_HASH: await hashWallboardPassword(
      "Display-only 42!",
    ),
    WALLBOARD_LOCAL_USERNAME: "wallboard",
  };
}

describe("wallboard credential service", () => {
  it("authenticates the normalized local wallboard credentials", async () => {
    const { attemptRepository } = createMemoryAttemptRepository();

    const result = await authenticateWallboardLogin(
      {
        clientAddress: "203.0.113.4",
        password: "Display-only 42!",
        username: " WALLBOARD ",
      },
      {
        attemptRepository,
        env: await configuredEnv(),
        now: () => now,
      },
    );

    expect(result).toEqual({
      id: "wallboard-local",
      name: "Command Centre Wallboard",
    });
  });

  it("rejects incorrect usernames and passwords", async () => {
    const { attemptRepository } = createMemoryAttemptRepository();
    const env = await configuredEnv();

    await expect(
      authenticateWallboardLogin(
        {
          clientAddress: "203.0.113.4",
          password: "Display-only 42!",
          username: "staff",
        },
        { attemptRepository, env, now: () => now },
      ),
    ).resolves.toBeNull();
    await expect(
      authenticateWallboardLogin(
        {
          clientAddress: "203.0.113.4",
          password: "wrong-password",
          username: "wallboard",
        },
        { attemptRepository, env, now: () => now },
      ),
    ).resolves.toBeNull();
  });

  it("does not authenticate when local wallboard login is not fully configured", async () => {
    const { attemptRepository } = createMemoryAttemptRepository();
    const env = {
      AUTH_SECRET: "test-auth-secret",
      DATABASE_URL: "postgresql://example",
      WALLBOARD_LOCAL_USERNAME: "wallboard",
    };

    expect(isWallboardLoginConfigured(env)).toBe(false);
    await expect(
      authenticateWallboardLogin(
        {
          clientAddress: "203.0.113.4",
          password: "Display-only 42!",
          username: "wallboard",
        },
        { attemptRepository, env, now: () => now },
      ),
    ).resolves.toBeNull();
  });

  it("blocks the sixth failed login attempt within the fifteen-minute window", async () => {
    const { attemptRepository } = createMemoryAttemptRepository();
    const env = await configuredEnv();
    const input = {
      clientAddress: "203.0.113.4",
      password: "wrong-password",
      username: "wallboard",
    };

    for (let index = 0; index < 5; index += 1) {
      await expect(
        authenticateWallboardLogin(input, {
          attemptRepository,
          env,
          now: () => now,
        }),
      ).resolves.toBeNull();
    }

    await expect(
      authenticateWallboardLogin(
        { ...input, password: "Display-only 42!" },
        { attemptRepository, env, now: () => now },
      ),
    ).resolves.toBeNull();
  });

  it("clears failed attempts after a successful login", async () => {
    const { attemptRepository, attempts } = createMemoryAttemptRepository();
    const env = await configuredEnv();
    const input = {
      clientAddress: "203.0.113.4",
      username: "wallboard",
    };

    await authenticateWallboardLogin(
      { ...input, password: "wrong-password" },
      { attemptRepository, env, now: () => now },
    );
    await expect(
      authenticateWallboardLogin(
        { ...input, password: "Display-only 42!" },
        { attemptRepository, env, now: () => now },
      ),
    ).resolves.toEqual({
      id: "wallboard-local",
      name: "Command Centre Wallboard",
    });

    expect(attempts).toEqual([]);
  });

  it("stores an opaque attempt key without the raw username or client address", async () => {
    const { attemptRepository, attempts } = createMemoryAttemptRepository();
    const env = await configuredEnv();
    const input = {
      clientAddress: "203.0.113.4",
      password: "wrong-password",
      username: "Wallboard Display",
    };

    await authenticateWallboardLogin(input, {
      attemptRepository,
      env,
      now: () => now,
    });

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.attemptKey).not.toContain(input.username);
    expect(attempts[0]?.attemptKey).not.toContain(input.clientAddress);
  });
});

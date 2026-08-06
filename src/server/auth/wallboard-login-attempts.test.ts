import { describe, expect, it } from "vitest";
import {
  createWallboardLoginAttemptRepository,
  createPostgresWallboardLoginAttemptRepository,
  type WallboardLoginAttempt,
  type WallboardLoginAttemptStore,
} from "./wallboard-login-attempts";

function memoryStore(): WallboardLoginAttemptStore {
  const attempts: WallboardLoginAttempt[] = [];

  return {
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
}

describe("wallboard login attempt repository", () => {
  it("blocks after five failures and clears the key", async () => {
    const repository = createWallboardLoginAttemptRepository(memoryStore());
    const now = new Date("2026-07-27T00:15:00.000Z");

    expect(await repository.isBlocked("attempt-key", now)).toBe(false);
    for (let index = 0; index < 5; index += 1) {
      await repository.recordFailure("attempt-key", now);
    }
    expect(await repository.isBlocked("attempt-key", now)).toBe(true);
    await repository.clear("attempt-key");
    expect(await repository.isBlocked("attempt-key", now)).toBe(false);
  });

  it("does not count failures older than the fifteen-minute window", async () => {
    const repository = createWallboardLoginAttemptRepository(memoryStore());
    const now = new Date("2026-07-27T00:15:00.000Z");

    for (let index = 0; index < 5; index += 1) {
      await repository.recordFailure(
        "attempt-key",
        new Date("2026-07-26T23:59:59.999Z"),
      );
    }

    expect(await repository.isBlocked("attempt-key", now)).toBe(false);
  });

  it("uses the injected tagged SQL function without DDL or interpolation", async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push({ text: strings.join(""), values });
      return Promise.resolve([{ count: 5 }]);
    }) as unknown as NonNullable<
      Parameters<typeof createPostgresWallboardLoginAttemptRepository>[0]["sql"]
    >;
    const repository = createPostgresWallboardLoginAttemptRepository({
      databaseUrl: "postgresql://example",
      sql,
    });
    const now = new Date("2026-07-27T00:15:00.000Z");

    expect(await repository.isBlocked("attempt-key", now)).toBe(true);
    await repository.recordFailure("attempt-key", now);
    await repository.clear("attempt-key");

    expect(queries).toHaveLength(4);
    expect(queries.every(({ text }) => !/create|alter|drop/i.test(text))).toBe(true);
    expect(queries[0].text).toContain("delete from");
    expect(queries[1].text).toContain("select count(*)");
    expect(queries[2].text).toContain("insert into");
    expect(queries[3].text).toContain("delete from");
    expect(queries.some(({ text }) => text.includes("attempt-key"))).toBe(false);
    expect(queries[1].values).toEqual(["attempt-key", expect.any(Date)]);
  });
});

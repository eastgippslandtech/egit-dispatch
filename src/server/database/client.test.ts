import { beforeEach, describe, expect, it, vi } from "vitest";

const { postgresMock } = vi.hoisted(() => ({
  postgresMock: vi.fn(() => ({ query: vi.fn() })),
}));

vi.mock("postgres", () => ({
  default: postgresMock,
}));

describe("shared Postgres clients", () => {
  beforeEach(() => {
    vi.resetModules();
    postgresMock.mockClear();
  });

  it("keeps named connection pools separate from the default shared client", async () => {
    const { getSharedPostgresClient } = await import("./client");
    const databaseUrl =
      "postgresql://postgres.project:secret@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres";

    const defaultClient = getSharedPostgresClient(databaseUrl);
    const presenceClient = getSharedPostgresClient(databaseUrl, "require", {
      max: 2,
      poolKey: "presence-overrides",
    });
    const samePresenceClient = getSharedPostgresClient(databaseUrl, "require", {
      max: 2,
      poolKey: "presence-overrides",
    });

    expect(defaultClient).not.toBe(presenceClient);
    expect(samePresenceClient).toBe(presenceClient);
    expect(postgresMock).toHaveBeenCalledTimes(2);
    expect(postgresMock.mock.calls[1]?.[1]).toMatchObject({
      max: 2,
    });
  });
});

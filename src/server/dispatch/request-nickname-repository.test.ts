import { describe, expect, it, vi } from "vitest";

import { createPostgresRequestNicknameRepository } from "./request-nickname-repository";

describe("request nickname repository", () => {
  it("loads nicknames for visible requests", async () => {
    const sql = vi.fn().mockResolvedValue([
      { request_id: "request-1", nickname: "Front counter printer" },
    ]);
    const repository = createPostgresRequestNicknameRepository({ sql: sql as never });

    await expect(repository.list(["request-1", "request-2"])).resolves.toEqual({
      "request-1": "Front counter printer",
    });
    expect(sql).toHaveBeenCalledOnce();
    await expect(repository.list([])).resolves.toEqual({});
    expect(sql).toHaveBeenCalledOnce();
  });

  it("upserts an edit and removes a cleared nickname", async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const repository = createPostgresRequestNicknameRepository({ sql: sql as never });

    await repository.set("request-1", "Front counter printer", "simeon@egit.com.au");
    await repository.set("request-1", null, "simeon@egit.com.au");

    expect(sql).toHaveBeenCalledTimes(2);
    expect(sql.mock.calls[0]).toContain("Front counter printer");
    expect(sql.mock.calls[1]).not.toContain("Front counter printer");
  });
});

import { describe, expect, it } from "vitest";
import {
  hashWallboardPassword,
  verifyWallboardPassword,
} from "./wallboard-password";

describe("wallboard password hashing", () => {
  it("round-trips a valid password through a salted scrypt hash", async () => {
    const encoded = await hashWallboardPassword("Correct Horse 42!");
    await expect(
      verifyWallboardPassword("Correct Horse 42!", encoded),
    ).resolves.toBe(true);
    await expect(
      verifyWallboardPassword("wrong", encoded),
    ).resolves.toBe(false);
    expect(encoded).toMatch(/^scrypt\$1\$/);
    expect(encoded).not.toContain("Correct Horse 42!");
  });

  it("rejects malformed hashes without throwing", async () => {
    await expect(
      verifyWallboardPassword("anything", "not-a-hash"),
    ).resolves.toBe(false);
  });
});

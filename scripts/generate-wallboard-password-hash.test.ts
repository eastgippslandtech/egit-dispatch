import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { verifyWallboardPassword } from "../src/server/auth/wallboard-password";

const execFileAsync = promisify(execFile);

describe("wallboard password hash generator", () => {
  it("generates a hash accepted by the production verifier", async () => {
    const password = "Wallboard Test 42!";
    const script = path.resolve(
      process.cwd(),
      "scripts/generate-wallboard-password-hash.mjs",
    );
    const { stdout } = await execFileAsync(process.execPath, [script, password]);

    expect(stdout).not.toContain(password);
    await expect(
      verifyWallboardPassword(password, stdout.trim()),
    ).resolves.toBe(true);
  });
});

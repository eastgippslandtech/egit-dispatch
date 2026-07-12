import { describe, expect, it, vi } from "vitest";

const webBrowser = vi.hoisted(() => ({
  maybeCompleteAuthSession: vi.fn(),
}));

vi.mock("expo-web-browser", () => webBrowser);

describe("Zoho native sign-in bootstrap", () => {
  it("registers browser auth-session completion handling", async () => {
    await import("./zoho-sign-in");

    expect(webBrowser.maybeCompleteAuthSession).toHaveBeenCalledTimes(1);
  });
});

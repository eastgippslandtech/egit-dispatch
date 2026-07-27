import { describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  default: () => ({
    auth: vi.fn(),
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

import { authCallbacks } from "@/auth";

import { createWallboardProvider } from "./wallboard-provider";

describe("wallboard credentials provider", () => {
  it("accepts wallboard credentials and prefers Vercel's forwarded address", async () => {
    let receivedInput: unknown;
    const provider = createWallboardProvider({
      authenticate: async (input) => {
        receivedInput = input;
        return {
          id: "wallboard-local",
          name: "Command Centre Wallboard",
        };
      },
    });

    expect(provider.id).toBe("wallboard");
    expect(provider.credentials).toMatchObject({
      password: { type: "password" },
      username: { type: "text" },
    });
    await expect(
      provider.authorize?.(
        { password: "Display-only 42!", username: "wallboard" },
        new Request("https://command-centre.example/auth", {
          headers: {
            "x-forwarded-for": "203.0.113.4",
            "x-vercel-forwarded-for": "198.51.100.7, 10.0.0.1",
          },
        }),
      ),
    ).resolves.toEqual({
      id: "wallboard-local",
      name: "Command Centre Wallboard",
    });
    expect(receivedInput).toEqual({
      clientAddress: "198.51.100.7",
      password: "Display-only 42!",
      username: "wallboard",
    });
  });

  it("returns no user when the credential service rejects the login", async () => {
    const provider = createWallboardProvider({
      authenticate: async () => null,
    });

    await expect(
      provider.authorize?.(
        { password: "wrong-password", username: "wallboard" },
        new Request("https://command-centre.example/auth"),
      ),
    ).resolves.toBeNull();
  });
});

describe("Auth.js access level callbacks", () => {
  it("signs the wallboard role only for the wallboard provider", async () => {
    await expect(
      authCallbacks.jwt({
        account: { provider: "wallboard" },
        token: {},
        user: { id: "wallboard-local" },
      } as never),
    ).resolves.toMatchObject({ accessLevel: "wallboard" });
  });

  it("signs the staff role for Zoho logins", async () => {
    await expect(
      authCallbacks.jwt({
        account: { provider: "zoho" },
        token: { email: "simeon@egit.com.au" },
      } as never),
    ).resolves.toMatchObject({ accessLevel: "staff" });
  });

  it("upgrades existing email-bearing JWTs to the staff role", async () => {
    await expect(
      authCallbacks.jwt({
        token: { email: "simeon@egit.com.au" },
      } as never),
    ).resolves.toMatchObject({ accessLevel: "staff" });
  });

  it("copies the signed role onto the session", async () => {
    await expect(
      authCallbacks.session({
        session: {
          accessLevel: "staff",
          user: { email: "simeon@egit.com.au" },
        },
        token: { accessLevel: "wallboard" },
      } as never),
    ).resolves.toMatchObject({ accessLevel: "wallboard" });
  });
});

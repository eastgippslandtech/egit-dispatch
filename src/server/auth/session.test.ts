import { describe, expect, it } from "vitest";

import {
  commandCentreAccessFromSession,
  isAuthDisabled,
  wallboardAccessFromSession,
} from "./session";

describe("Command Centre session access", () => {
  const env = {
    ALLOWED_AUTH_EMAILS:
      "simeon@egit.com.au,mattd@egit.com.au,jervy@egit.com.au,riley@egit.com.au",
  };
  const wallboardSession = {
    accessLevel: "wallboard" as const,
    user: { name: "Command Centre Wallboard" },
  };

  it("requires a Zoho-authenticated session", () => {
    expect(commandCentreAccessFromSession(null, env)).toEqual({
      status: "unauthenticated",
    });
  });

  it("does not approve an allowlisted email without a signed access role", () => {
    const session = {
      user: { email: "simeon@egit.com.au", name: "Simeon" },
    };

    expect(commandCentreAccessFromSession(session, env)).toEqual({
      status: "unauthenticated",
    });
    expect(wallboardAccessFromSession(session, env)).toEqual({
      status: "unauthenticated",
    });
  });

  it("restricts a signed wallboard session to wallboard-only access", () => {
    expect(commandCentreAccessFromSession(wallboardSession, env)).toEqual({
      name: "Command Centre Wallboard",
      status: "wallboard-only",
    });
  });

  it("approves a signed wallboard session for wallboard access", () => {
    expect(wallboardAccessFromSession(wallboardSession, env)).toEqual({
      accessLevel: "wallboard",
      name: "Command Centre Wallboard",
      status: "approved",
    });
  });

  it("approves a build-mode mock session when auth is disabled", () => {
    expect(commandCentreAccessFromSession(null, { DISABLE_AUTH: "true" })).toEqual({
      status: "approved",
      accessLevel: "staff",
      email: "build-mode@egit.local",
      name: "Build Mode",
      authDisabled: true,
    });
  });

  it("does not allow DISABLE_AUTH in production mode", () => {
    const productionEnv = {
      DISABLE_AUTH: "true",
      NODE_ENV: "production",
    };

    expect(isAuthDisabled(productionEnv)).toBe(false);
    expect(commandCentreAccessFromSession(null, productionEnv)).toEqual({
      status: "unauthenticated",
    });
  });

  it("allows approved staff", () => {
    for (const email of [
      "simeon@egit.com.au",
      "mattd@egit.com.au",
      "jervy@egit.com.au",
      "riley@egit.com.au",
    ]) {
      expect(
        commandCentreAccessFromSession(
          {
            accessLevel: "staff",
            user: { email, name: email.split("@")[0] },
          },
          env,
        ),
      ).toEqual({
        status: "approved",
        accessLevel: "staff",
        email,
        name: email.split("@")[0],
      });
    }
  });

  it("allows approved staff to access the wallboard as staff", () => {
    expect(
      wallboardAccessFromSession(
        {
          accessLevel: "staff",
          user: { email: "simeon@egit.com.au", name: "Simeon" },
        },
        env,
      ),
    ).toEqual({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
  });

  it("shows not-approved state for non-allowlisted Zoho users", () => {
    const session = {
      accessLevel: "staff" as const,
      user: { email: "external@example.com", name: "External User" },
    };
    const expected = {
      status: "not-approved",
      email: "external@example.com",
      name: "External User",
    } as const;

    expect(commandCentreAccessFromSession(session, env)).toEqual(expected);
    expect(wallboardAccessFromSession(session, env)).toEqual(expected);
  });
});

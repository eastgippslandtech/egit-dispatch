import { describe, expect, it } from "vitest";

import { commandCentreAccessFromSession, isAuthDisabled } from "./session";

describe("Command Centre session access", () => {
  const env = {
    ALLOWED_AUTH_EMAILS:
      "simeon@egit.com.au,mattd@egit.com.au,jervy@egit.com.au,riley@egit.com.au",
  };

  it("requires a Zoho-authenticated session", () => {
    expect(commandCentreAccessFromSession(null, env)).toEqual({
      status: "unauthenticated",
    });
  });

  it("approves a build-mode mock session when auth is disabled", () => {
    expect(commandCentreAccessFromSession(null, { DISABLE_AUTH: "true" })).toEqual({
      status: "approved",
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
          { user: { email, name: email.split("@")[0] } },
          env,
        ),
      ).toEqual({
        status: "approved",
        email,
        name: email.split("@")[0],
      });
    }
  });

  it("shows not-approved state for non-allowlisted Zoho users", () => {
    expect(
      commandCentreAccessFromSession(
        { user: { email: "external@example.com", name: "External User" } },
        env,
      ),
    ).toEqual({
      status: "not-approved",
      email: "external@example.com",
      name: "External User",
    });
  });
});

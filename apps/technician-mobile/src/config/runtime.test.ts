import { describe, expect, it } from "vitest";

import { getMobileRuntimeConfig } from "./runtime";

describe("mobile runtime config", () => {
  it("defaults production builds to real Zoho auth", () => {
    expect(getMobileRuntimeConfig({}, { isDevelopment: false }).authMode).toBe(
      "zoho",
    );
  });

  it("keeps production Zoho sign-in configured with the public client ID", () => {
    expect(
      getMobileRuntimeConfig({}, { isDevelopment: false }).zohoClientId,
    ).toBe("1000.JW3AY19TI2SGLRCGOWJ1TSUW6T681P");
  });

  it("does not allow mock auth in production builds", () => {
    expect(
      getMobileRuntimeConfig(
        { EXPO_PUBLIC_AUTH_MODE: "mock" },
        { isDevelopment: false },
      ).authMode,
    ).toBe("zoho");
  });

  it("keeps mock auth available for local development only", () => {
    expect(
      getMobileRuntimeConfig(
        { EXPO_PUBLIC_AUTH_MODE: "mock" },
        { isDevelopment: true },
      ).authMode,
    ).toBe("mock");
  });
});

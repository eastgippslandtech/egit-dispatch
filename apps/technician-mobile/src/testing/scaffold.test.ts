import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getConfig } from "expo/config";
import { describe, expect, it } from "vitest";

const projectRoot = existsSync(resolve(process.cwd(), "app.config.ts"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/technician-mobile");

function readProjectFile(relativePath: string) {
  return readFileSync(resolve(projectRoot, relativePath), "utf8");
}

describe("technician mobile scaffold", () => {
  it("resolves the Command Centre native identity", () => {
    const { exp } = getConfig(projectRoot);
    const plugins = (exp.plugins ?? []).map((plugin) =>
      Array.isArray(plugin) ? plugin[0] : plugin,
    );

    expect(exp).toMatchObject({
      name: "EGIT Command Centre",
      slug: "egit-command-centre-technician",
      scheme: "egitcommand",
      version: "0.1.2",
      orientation: "portrait",
      userInterfaceStyle: "dark",
      ios: {
        bundleIdentifier: "au.com.egit.commandcentre",
        supportsTablet: false,
      },
      android: {
        package: "au.com.egit.commandcentre",
      },
      experiments: { typedRoutes: true },
    });
    expect(plugins).toEqual(
      expect.arrayContaining(["expo-router", "expo-secure-store", "expo-sqlite"]),
    );
  }, 30_000);

  it("provides deterministic native scripts and required Expo modules", () => {
    const packageJson = JSON.parse(readProjectFile("package.json"));

    expect(packageJson.scripts).toMatchObject({
      start: "expo start",
      ios: "expo run:ios",
      android: "expo run:android",
      typecheck: "tsc --noEmit",
      lint: "expo lint",
      test: "vitest run",
    });
    expect(packageJson.dependencies).toEqual(
      expect.objectContaining({
        "expo-auth-session": expect.any(String),
        "expo-dev-client": expect.any(String),
        "expo-linking": expect.any(String),
        "expo-router": expect.any(String),
        "expo-secure-store": expect.any(String),
        "expo-sqlite": expect.any(String),
        "expo-web-browser": expect.any(String),
      }),
    );
  });

  it("uses the planned root Expo Router directory", () => {
    expect(existsSync(resolve(projectRoot, "app/_layout.tsx"))).toBe(true);
    expect(existsSync(resolve(projectRoot, "app/index.tsx"))).toBe(true);
    expect(existsSync(resolve(projectRoot, "src/app"))).toBe(false);
  });

  it("owns its native Expo lint toolchain", () => {
    const packageJson = JSON.parse(readProjectFile("package.json"));
    const eslintConfigPath = resolve(projectRoot, "eslint.config.mjs");

    expect(packageJson.devDependencies).toEqual(
      expect.objectContaining({
        eslint: expect.any(String),
        "eslint-config-expo": expect.any(String),
      }),
    );
    expect(existsSync(eslintConfigPath)).toBe(true);
    if (!existsSync(eslintConfigPath)) return;

    expect(readFileSync(eslintConfigPath, "utf8")).toContain(
      'from "eslint-config-expo/flat.js"',
    );
  });

  it("documents fail-closed public environment defaults without a client secret", () => {
    const envPath = resolve(projectRoot, ".env.example");

    expect(existsSync(envPath)).toBe(true);
    if (!existsSync(envPath)) return;

    const env = readFileSync(envPath, "utf8");
    expect(env).toContain("EXPO_PUBLIC_API_BASE_URL=https://command.egit.com.au");
    expect(env).toContain("EXPO_PUBLIC_AUTH_MODE=zoho");
    expect(env).toContain("EXPO_PUBLIC_ZOHO_CLIENT_ID=");
    expect(env).not.toMatch(/SECRET/i);
  });

  it("includes valid EAS build configuration", () => {
    const easPath = resolve(projectRoot, "eas.json");

    expect(existsSync(easPath)).toBe(true);
    if (!existsSync(easPath)) return;

    expect(JSON.parse(readFileSync(easPath, "utf8"))).toMatchObject({
      build: {
        development: {
          developmentClient: true,
          distribution: "internal",
        },
      },
    });
  });

  it("records the resolved Expo, React Native, and React versions", () => {
    const startHerePath = resolve(projectRoot, "START-HERE.md");

    expect(existsSync(startHerePath)).toBe(true);
    if (!existsSync(startHerePath)) return;

    const startHere = readFileSync(startHerePath, "utf8");
    expect(startHere).toContain("Expo SDK: ~57.0.4");
    expect(startHere).toContain("React Native: 0.86.0");
    expect(startHere).toContain("React: 19.2.3");
  });
});

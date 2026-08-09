import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    exclude: ["apps/technician-mobile/**", "node_modules/**"],
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "expo-web-browser": path.resolve(
        __dirname,
        "./src/test/mocks/expo-web-browser.ts",
      ),
    },
  },
});

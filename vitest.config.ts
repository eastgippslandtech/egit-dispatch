import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
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

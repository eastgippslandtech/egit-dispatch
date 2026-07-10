import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});

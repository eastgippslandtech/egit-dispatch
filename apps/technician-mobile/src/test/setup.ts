import { vi } from "vitest";

Object.defineProperty(globalThis, "__DEV__", {
  configurable: true,
  value: false,
});

vi.mock("expo-web-browser", () => ({
  maybeCompleteAuthSession: vi.fn(),
}));

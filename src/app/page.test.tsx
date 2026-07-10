import { expect, test, vi } from "vitest";

import Home from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
}));

test("redirects the root route to Command Centre", () => {
  expect(() => Home()).toThrow("NEXT_REDIRECT:/dispatch");
});

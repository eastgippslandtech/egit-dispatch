import { describe, expect, it } from "vitest";

import { colours } from "./tokens";

describe("brand colour tokens", () => {
  it("uses the supplied Command Centre logo palette for the app shell", () => {
    expect(colours.brandNavy).toBe("#071526");
    expect(colours.brandOrange).toBe("#FF823A");
    expect(colours.brandRed).toBe("#F21F31");
    expect(colours.canvas).toBe(colours.brandNavy);
    expect(colours.primary).toBe(colours.brandOrange);
    expect(colours.critical).toBe(colours.brandRed);
  });
});

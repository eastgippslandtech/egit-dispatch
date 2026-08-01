import { describe, expect, it } from "vitest";

import { cleanRequestTitle } from "./request-title";

describe("cleanRequestTitle", () => {
  it("removes a leading MSP Central request identifier", () => {
    expect(
      cleanRequestTitle(
        "6768000001414219 Printer offline",
        "6768000001414219",
      ),
    ).toBe("Printer offline");
  });

  it("removes a labelled request identifier", () => {
    expect(cleanRequestTitle("REQ-100284 Printer offline", "REQ-100284")).toBe(
      "Printer offline",
    );
  });

  it("preserves useful legacy ticket references", () => {
    expect(cleanRequestTitle("[CW 237673] Retailer Archive Webapp")).toBe(
      "[CW 237673] Retailer Archive Webapp",
    );
  });
});

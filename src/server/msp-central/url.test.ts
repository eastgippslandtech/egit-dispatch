import { describe, expect, it } from "vitest";

import { buildMspCentralRequestUrl } from "./url";

describe("MSP Central request URL builder", () => {
  it("fails safely when base URL or request ID is missing", () => {
    expect(buildMspCentralRequestUrl("REQ-1", "")).toBeUndefined();
    expect(buildMspCentralRequestUrl("", "https://helpdesk.example")).toBeUndefined();
  });

  it("supports configurable URL templates", () => {
    expect(
      buildMspCentralRequestUrl(
        "REQ-1",
        "https://helpdesk.example/requests/{request}",
      ),
    ).toBe("https://helpdesk.example/requests/REQ-1");
  });

  it("falls back to a safe query parameter", () => {
    expect(buildMspCentralRequestUrl("REQ 1", "https://helpdesk.example")).toBe(
      "https://helpdesk.example?request=REQ%201",
    );
  });
});

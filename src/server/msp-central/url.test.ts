import { describe, expect, it } from "vitest";

import {
  buildMspCentralRequestUrl,
  normalizeMspCentralRequestUrl,
} from "./url";

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

  it("builds the current MSP Central Helpdesk detail route from portal and internal request ID", () => {
    expect(
      buildMspCentralRequestUrl(
        "6768000001410416",
        "",
        "memsp1783593801295",
      ),
    ).toBe(
      "https://sdpod.mspcentral.manageengine.com.au/app/memsp1783593801295/ui/requests/6768000001410416/details",
    );
  });

  it("does not invent default MSP Central detail links from display ticket numbers", () => {
    expect(buildMspCentralRequestUrl("21988", "", "memsp1783593801295")).toBeUndefined();
  });

  it("rewrites old MSP Central shell request links to the current Helpdesk frame route", () => {
    expect(
      normalizeMspCentralRequestUrl(
        "https://mspcentral.manageengine.com.au/mainlayout#msp/helpdesk/app/memsp1783593801295/Requests/view/6768000001410416",
      ),
    ).toBe(
      "https://sdpod.mspcentral.manageengine.com.au/app/memsp1783593801295/ui/requests/6768000001410416/details",
    );
  });
});

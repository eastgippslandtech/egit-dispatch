import { describe, expect, it } from "vitest";

import config from "./app.config";

describe("technician mobile native permissions", () => {
  it("declares the Android foreground location permissions needed for the OS prompt", () => {
    expect(config.android?.permissions).toEqual(
      expect.arrayContaining(["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION"]),
    );
  });

  it("declares Android notification permission for the runtime prompt", () => {
    expect(config.android?.permissions).toEqual(
      expect.arrayContaining(["POST_NOTIFICATIONS"]),
    );
  });
});

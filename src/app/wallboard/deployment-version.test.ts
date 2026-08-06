import { describe, expect, it } from "vitest";

import {
  getDeploymentVersion,
  shouldReloadForDeployment,
} from "./deployment-version";

describe("wallboard deployment version", () => {
  it("prefers the deployment URL because it changes for every Vercel release", () => {
    expect(
      getDeploymentVersion({
        VERCEL_GIT_COMMIT_SHA: "commit-sha",
        VERCEL_URL: "egit-dispatch-new.vercel.app",
      }),
    ).toBe("egit-dispatch-new.vercel.app");
  });

  it("reloads only when a newer deployment is serving wallboard data", () => {
    expect(
      shouldReloadForDeployment(
        "egit-dispatch-old.vercel.app",
        "egit-dispatch-new.vercel.app",
      ),
    ).toBe(true);
    expect(
      shouldReloadForDeployment(
        "egit-dispatch-new.vercel.app",
        "egit-dispatch-new.vercel.app",
      ),
    ).toBe(false);
    expect(shouldReloadForDeployment("local", "local")).toBe(false);
    expect(shouldReloadForDeployment("", "new")).toBe(false);
  });
});

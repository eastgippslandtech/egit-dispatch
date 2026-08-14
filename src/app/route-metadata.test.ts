import { describe, expect, it } from "vitest";

import { metadata as dispatchMetadata } from "./dispatch/page";
import { metadata as queueMetadata } from "./dispatch/queue/page";
import { metadata as wallboardMetadata } from "./wallboard/page";

describe("Command Centre route metadata", () => {
  it("uses clear browser tab titles for the main Command Centre screens", () => {
    expect(dispatchMetadata.title).toBe("Dispatch");
    expect(wallboardMetadata.title).toBe("Wallboard");
    expect(queueMetadata.title).toBe("Queue");
  });
});

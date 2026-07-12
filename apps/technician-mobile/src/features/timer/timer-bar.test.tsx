import { Fragment, createElement, type PropsWithChildren } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActiveTimer } from "../../contracts/mobile";

import { TimerBar } from "./timer-bar";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: ({ children }: PropsWithChildren) =>
    createElement(Fragment, null, children),
}));

const timer: ActiveTimer = {
  accumulatedPausedSeconds: 0,
  id: "timer-riley-1",
  jobId: "job-1",
  pausedAt: null,
  startedAt: "2026-07-12T01:00:00.000Z",
  technicianId: "staff-riley",
};

describe("TimerBar", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps counting while a timer is running", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T01:00:00.000Z"));
    const testGlobal = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation((message) => {
      if (!String(message).includes("react-test-renderer is deprecated")) {
        throw new Error(`Unexpected render error: ${String(message)}`);
      }
    });
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true;

    let rendered: TestRenderer.ReactTestRenderer | undefined;
    try {
      act(() => {
        rendered = TestRenderer.create(
          <TimerBar
            jobTitle="Firewall repair"
            now={new Date()}
            onStop={() => undefined}
            timer={timer}
          />,
        );
      });
    } finally {
      consoleError.mockRestore();
    }
    if (!rendered) {
      throw new Error("Timer bar did not render.");
    }

    expect(textValues(rendered)).toContain("0:00");

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(textValues(rendered)).toContain("0:02");
  });
});

function textValues(rendered: TestRenderer.ReactTestRenderer) {
  return rendered.root
    .findAll((node) => String(node.type) === "Text")
    .map((node) => node.children.join(""));
}

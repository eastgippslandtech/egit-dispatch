import { Fragment, createElement, type PropsWithChildren } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MobileJob, StoppedTimer } from "../../contracts/mobile";
import type { TechnicianRepository } from "../../data/technician-repository";
import { MOBILE_JOB_FIXTURES } from "../../testing/fixtures";
import {
  ActiveTimerProvider,
  GlobalTimerBanner,
  useActiveTimer,
} from "./active-timer-provider";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: ({ children }: PropsWithChildren) =>
    createElement(Fragment, null, children),
}));

const secureStore = vi.hoisted(() => ({
  values: new Map<string, string>(),
}));

vi.mock("expo-secure-store", () => ({
  deleteItemAsync: vi.fn(async (key: string) => {
    secureStore.values.delete(key);
  }),
  getItemAsync: vi.fn(async (key: string) => secureStore.values.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureStore.values.set(key, value);
  }),
}));

const job = MOBILE_JOB_FIXTURES[0] as MobileJob;

describe("active timer provider", () => {
  beforeEach(() => {
    secureStore.values.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T02:05:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows an orange global running timer banner and stops from any screen", async () => {
    const stoppedTimer: StoppedTimer = {
      accumulatedPausedSeconds: 0,
      actualElapsedMinutes: 5,
      id: "timer-start-1",
      jobId: job.id,
      pausedAt: null,
      roundedMinutes: 15,
      startedAt: "2026-07-14T02:00:00.000Z",
      stoppedAt: "2026-07-14T02:05:00.000Z",
      technicianId: job.technician.id,
    };
    const repository = {
      startTimer: vi.fn(async () => ({
        accumulatedPausedSeconds: 0,
        id: "timer-start-1",
        jobId: job.id,
        pausedAt: null,
        startedAt: "2026-07-14T02:00:00.000Z",
        technicianId: job.technician.id,
      })),
      stopTimer: vi.fn(async () => stoppedTimer),
    } as unknown as TechnicianRepository;

    const rendered = await renderWithProvider(repository);

    expect(textValues(rendered)).not.toContain("Timer running");

    await pressButton(rendered, "Start test timer");

    expect(textValues(rendered)).toEqual(
      expect.arrayContaining(["Timer running", job.title, "5:00"]),
    );

    await pressButton(rendered, "Stop timer");

    expect(repository.stopTimer).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: job.id,
        startedAt: "2026-07-14T02:00:00.000Z",
        timerId: "timer-start-1",
      }),
    );
    expect(textValues(rendered)).toContain("Timer stopped: 15 minutes queued");
  });

  it("shows a visible message when starting a timer fails", async () => {
    const repository = {
      startTimer: vi.fn(async () => {
        throw new Error("Mobile API request failed with 404.");
      }),
    } as unknown as TechnicianRepository;

    const rendered = await renderWithProvider(repository);

    await pressButton(rendered, "Start test timer");

    expect(textValues(rendered)).toContain(
      "Mobile API request failed with 404.",
    );
    expect(textValues(rendered)).not.toContain("Timer running");
  });
});

function TimerProbe() {
  const { startTimerForJob } = useActiveTimer();
  return createElement("Pressable", {
    accessibilityLabel: "Start test timer",
    accessibilityRole: "button",
    onPress: () => startTimerForJob(job),
  });
}

async function renderWithProvider(repository: TechnicianRepository) {
  let rendered: ReactTestRenderer | undefined;
  const consoleError = vi.spyOn(console, "error").mockImplementation((message) => {
    if (!String(message).includes("react-test-renderer is deprecated")) {
      throw new Error(`Unexpected render error: ${String(message)}`);
    }
  });
  const testGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;

  try {
    await act(async () => {
      rendered = TestRenderer.create(
        <ActiveTimerProvider repository={repository}>
          <GlobalTimerBanner now={new Date("2026-07-14T02:05:00.000Z")} />
          <TimerProbe />
        </ActiveTimerProvider>,
      );
      await Promise.resolve();
    });
  } finally {
    consoleError.mockRestore();
  }

  if (!rendered) {
    throw new Error("Timer provider did not render.");
  }
  return rendered;
}

async function pressButton(rendered: ReactTestRenderer, label: string) {
  const button = rendered.root.find(
    (node) =>
      node.props.accessibilityRole === "button" &&
      node.props.accessibilityLabel === label,
  );
  await act(async () => {
    await button.props.onPress();
  });
}

function textValues(rendered: ReactTestRenderer) {
  return rendered.root
    .findAll((node) => String(node.type) === "Text")
    .map((node) => node.children.join(""));
}

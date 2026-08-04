import { type ReactNode } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TechnicianRepository } from "../../data/technician-repository";
import { AppProviders, type TechnicianSession } from "../../providers/app-providers";
import { MOBILE_JOB_FIXTURES, MOBILE_STAFF_FIXTURES } from "../../testing/fixtures";

import { type ScheduleState, useSchedule } from "./use-schedule";

vi.mock("react-native", () => ({
  AppState: {
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));

const job = MOBILE_JOB_FIXTURES.find((candidate) => candidate.id === "firewall-riley");
const staff = MOBILE_STAFF_FIXTURES.find(
  (candidate) => candidate.email === "riley@egit.com.au",
);

if (!job || !staff) {
  throw new Error("Riley's mobile fixtures are required.");
}

const session: TechnicianSession = {
  staff,
  status: "approved",
};

describe("useSchedule", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-09T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a saved schedule while the live refresh is still pending", async () => {
    const repository = createRepository({
      listCachedSchedule: vi.fn().mockResolvedValue([job]),
      listSchedule: vi.fn(() => new Promise<never>(() => undefined)),
    });
    let state: ScheduleState | undefined;

    await renderProbe(repository, (nextState) => {
      state = nextState;
    });

    expect(state?.jobs).toEqual([job]);
    expect(state?.loading).toBe(false);
    expect(state?.connectionState).toBe("connecting");
  });

  it("deduplicates refreshes and keeps the current schedule after an error", async () => {
    let rejectRefresh: ((error: Error) => void) | undefined;
    const listSchedule = vi
      .fn()
      .mockResolvedValueOnce([job])
      .mockImplementationOnce(
        () =>
          new Promise<never>((_resolve, reject) => {
            rejectRefresh = reject;
          }),
      );
    const repository = createRepository({ listSchedule });
    let state: ScheduleState | undefined;

    await renderProbe(repository, (nextState) => {
      state = nextState;
    });
    expect(state?.jobs).toEqual([job]);

    let firstRefresh: Promise<void> | undefined;
    let secondRefresh: Promise<void> | undefined;
    await act(async () => {
      firstRefresh = state?.refresh();
      secondRefresh = state?.refresh();
      await Promise.resolve();
    });

    expect(listSchedule).toHaveBeenCalledTimes(2);

    await act(async () => {
      rejectRefresh?.(new Error("offline"));
      await Promise.all([firstRefresh, secondRefresh]);
    });

    expect(state?.jobs).toEqual([job]);
    expect(state?.error).toBe("offline");
  });

  it("uses cached data when the offline repository becomes ready during a slow remote load", async () => {
    const remoteRepository = createRepository({
      listSchedule: vi.fn(() => new Promise<never>(() => undefined)),
    });
    const offlineRepository = createRepository({
      listCachedSchedule: vi.fn().mockResolvedValue([job]),
      listSchedule: vi.fn(() => new Promise<never>(() => undefined)),
    });
    let state: ScheduleState | undefined;

    function Probe(): ReactNode {
      state = useSchedule({ from: "2026-07-09", to: "2026-07-09" });
      return null;
    }

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <AppProviders initialSession={session} repository={remoteRepository}>
          <Probe />
        </AppProviders>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      renderer.update(
        <AppProviders initialSession={session} repository={offlineRepository}>
          <Probe />
        </AppProviders>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(offlineRepository.listCachedSchedule).toHaveBeenCalledTimes(1);
    expect(offlineRepository.listSchedule).toHaveBeenCalledTimes(1);
    expect(state?.jobs).toEqual([job]);
    expect(state?.loading).toBe(false);
  });
});

async function renderProbe(
  repository: TechnicianRepository,
  onState: (state: ScheduleState) => void,
) {
  function Probe(): ReactNode {
    onState(useSchedule({ from: "2026-07-09", to: "2026-07-09" }));
    return null;
  }

  await act(async () => {
    TestRenderer.create(
      <AppProviders initialSession={session} repository={repository}>
        <Probe />
      </AppProviders>,
    );
    await Promise.resolve();
  });
}

function createRepository(
  overrides: Partial<TechnicianRepository>,
): TechnicianRepository {
  const unavailable = async () => {
    throw new Error("Not needed in this schedule test.");
  };

  return {
    addPart: unavailable,
    attachEvidence: unavailable,
    completeJob: unavailable,
    getCurrentStaff: async () => staff,
    getJob: unavailable,
    listSchedule: async () => [],
    saveSignOff: unavailable,
    saveWorklog: unavailable,
    startTimer: unavailable,
    stopTimer: unavailable,
    updateStatus: unavailable,
    ...overrides,
  } as TechnicianRepository;
}

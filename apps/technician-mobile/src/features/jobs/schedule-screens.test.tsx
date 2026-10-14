import {
  Fragment,
  createElement,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MyWorkRoute, {
  buildMyWorkSections,
} from "../../../app/(tabs)/my-work";
import UnassignedRoute from "../../../app/(tabs)/unassigned";
import TodayRoute from "../../../app/(tabs)/today";
import {
  AppProviders,
  type TechnicianSession,
} from "../../providers/app-providers";
import type { MobileJob } from "../../contracts/mobile";
import type { TechnicianRepository } from "../../data/technician-repository";
import { MockTechnicianRepository } from "../../data/mock-technician-repository";
import {
  MOBILE_JOB_FIXTURES,
  MOBILE_STAFF_FIXTURES,
} from "../../testing/fixtures";

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  AppState: {
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
  FlatList: ({
    data,
    ListEmptyComponent,
    renderItem,
  }: {
    data: unknown[];
    ListEmptyComponent?: () => ReactNode;
    renderItem: (input: { item: unknown }) => ReactNode;
  }) =>
    data.length
      ? createElement(
          Fragment,
          null,
          data.map((item, index) =>
            createElement(Fragment, { key: index }, renderItem({ item })),
          ),
        )
      : createElement(Fragment, null, ListEmptyComponent?.()),
  Pressable: "Pressable",
  RefreshControl: "RefreshControl",
  ScrollView: ({ children }: PropsWithChildren) =>
    createElement(Fragment, null, children),
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));

vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: PropsWithChildren) =>
    createElement(Fragment, null, children),
}));

vi.mock("expo-router", () => ({
  Link: ({ children }: PropsWithChildren) =>
    createElement(Fragment, null, children),
}));

const riley = MOBILE_STAFF_FIXTURES.find(
  (staff) => staff.email === "riley@egit.com.au",
);

if (!riley) {
  throw new Error("Riley's mobile staff fixture is required.");
}

const approvedRileySession: TechnicianSession = {
  status: "approved",
  staff: riley,
};

async function renderScreen(
  screen: "today" | "my-work" | "unassigned",
  repository?: TechnicianRepository,
) {
  let rendered: ReactTestRenderer | undefined;
  const testGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const consoleError = vi.spyOn(console, "error").mockImplementation((message) => {
    if (!String(message).includes("react-test-renderer is deprecated")) {
      throw new Error(`Unexpected render error: ${String(message)}`);
    }
  });

  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => {
      rendered = TestRenderer.create(
        <AppProviders
          initialSession={approvedRileySession}
          repository={repository}
        >
          {screen === "today" ? (
            <TodayRoute />
          ) : screen === "my-work" ? (
            <MyWorkRoute />
          ) : (
            <UnassignedRoute />
          )}
        </AppProviders>,
      );
      await Promise.resolve();
    });
  } finally {
    consoleError.mockRestore();
  }

  if (!rendered) {
    throw new Error("The screen did not render.");
  }

  return rendered;
}

function textValues(rendered: ReactTestRenderer) {
  return rendered.root
    .findAll((node) => String(node.type) === "Text")
    .map((node) => node.children.join(""));
}

function indexOfText(rendered: ReactTestRenderer, value: string) {
  return textValues(rendered).findIndex((text) => text.includes(value));
}

describe("native schedule screens", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T01:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows only Riley's chronological jobs for the selected day", async () => {
    vi.setSystemTime(new Date("2026-07-08T23:30:00.000Z"));
    const rendered = await renderScreen("today");

    expect(indexOfText(rendered, "Firewall firmware window")).toBeLessThan(
      indexOfText(rendered, "Internal operations meeting"),
    );
    expect(textValues(rendered)).not.toContain("File server disk expansion");
  });

  it("labels Outlook-only events as read-only", async () => {
    vi.setSystemTime(new Date("2026-07-08T23:30:00.000Z"));
    const rendered = await renderScreen("today");

    expect(textValues(rendered)).toContain("Outlook Read Only");
    expect(textValues(rendered)).toContain(
      "This Outlook event is not linked to a helpdesk request.",
    );
  });

  it("starts the Today screen on the real current day", async () => {
    const rendered = await renderScreen("today");
    const texts = textValues(rendered);

    expect(texts).toContain("Today");
    expect(texts).toContain("Sunday, 12 July");
    expect(texts).not.toContain("Thursday, 9 July");
  });

  it("can move forward to tomorrow and keeps that date selected", async () => {
    const rendered = await renderScreen("today");
    const nextButton = rendered.root.find(
      (node) => node.props.accessibilityLabel === "Next day",
    );

    await act(async () => {
      nextButton.props.onPress();
      await Promise.resolve();
    });

    const texts = textValues(rendered);
    expect(texts).toContain("Tomorrow");
    expect(texts).toContain("Monday, 13 July");
  });

  it("clears stale job cards immediately while a newly selected day loads", async () => {
    vi.setSystemTime(new Date("2026-07-08T23:30:00.000Z"));
    const firstDayJobs = MOBILE_JOB_FIXTURES.filter((job) =>
      ["firewall-riley", "outlook-block-riley"].includes(job.id),
    );
    const secondDayJobs = MOBILE_JOB_FIXTURES.filter(
      (job) => job.id === "remote-support-riley",
    );
    let resolveSecondDay: ((jobs: MobileJob[]) => void) | undefined;
    const repository = createScheduleOnlyRepository(
      vi.fn(({ from }) => {
        if (from === "2026-07-09") {
          return Promise.resolve(firstDayJobs);
        }

        return new Promise<MobileJob[]>((resolve) => {
          resolveSecondDay = resolve;
        });
      }),
    );
    const rendered = await renderScreen("today", repository);
    const nextButton = rendered.root.find(
      (node) => node.props.accessibilityLabel === "Next day",
    );

    expect(textValues(rendered)).toContain("Firewall firmware window");

    await act(async () => {
      nextButton.props.onPress();
      await Promise.resolve();
    });

    const loadingTexts = textValues(rendered);
    expect(loadingTexts).toContain("Friday, 10 July");
    expect(loadingTexts).not.toContain("Firewall firmware window");

    await act(async () => {
      resolveSecondDay?.(secondDayJobs);
      await Promise.resolve();
    });

    expect(textValues(rendered)).toContain("Remote payroll support");
  });

  it("can move backward to yesterday and keeps that date selected", async () => {
    const rendered = await renderScreen("today");
    const previousButton = rendered.root.find(
      (node) => node.props.accessibilityLabel === "Previous day",
    );

    await act(async () => {
      previousButton.props.onPress();
      await Promise.resolve();
    });

    const texts = textValues(rendered);
    expect(texts).toContain("Yesterday");
    expect(texts).toContain("Saturday, 11 July");
  });

  it("shows a Today button away from today and returns to the current schedule", async () => {
    const rendered = await renderScreen("today");
    const nextButton = rendered.root.find(
      (node) => node.props.accessibilityLabel === "Next day",
    );

    expect(
      rendered.root.findAll(
        (node) => node.props.accessibilityLabel === "Show today's schedule",
      ),
    ).toHaveLength(0);

    await act(async () => {
      nextButton.props.onPress();
      await Promise.resolve();
    });

    const todayButton = rendered.root.find(
      (node) => node.props.accessibilityLabel === "Show today's schedule",
    );

    await act(async () => {
      todayButton.props.onPress();
      await Promise.resolve();
    });

    const texts = textValues(rendered);
    expect(texts).toContain("Today");
    expect(texts).toContain("Sunday, 12 July");
  });

  it("shows My Work as category cards before drilling into related jobs", async () => {
    vi.setSystemTime(new Date("2026-07-08T23:30:00.000Z"));
    const rendered = await renderScreen("my-work");
    const texts = textValues(rendered);

    expect(texts).toContain("Today");
    expect(texts).toContain("Upcoming");
    expect(texts).toContain("Assigned to me");
    expect(texts).toContain("SLA risk");
    expect(texts).toContain("Waiting on me");
    expect(texts).toContain("Recently completed");
    expect(texts).not.toContain("Remote payroll support");
    expect(texts).not.toContain("File server disk expansion");

    const upcomingCard = rendered.root.find(
      (node) =>
        node.props.accessibilityRole === "button" &&
        node.props.accessibilityLabel === "Open Upcoming jobs",
    );

    await act(async () => {
      upcomingCard.props.onPress();
      await Promise.resolve();
    });

    const drilldownTexts = textValues(rendered);
    expect(drilldownTexts).toContain("Upcoming jobs");
    expect(drilldownTexts).toContain("Remote payroll support");
    expect(drilldownTexts).not.toContain("File server disk expansion");
  });

  it("requests a date range based on today instead of a stale fixed cutoff", async () => {
    vi.setSystemTime(new Date("2026-07-12T01:00:00.000Z"));
    const listSchedule = vi.fn(async () => []);

    await renderScreen("my-work", createScheduleOnlyRepository(listSchedule));

    expect(listSchedule).toHaveBeenCalledWith({
      from: "2026-06-12",
      to: "2026-10-10",
    });
  });

  it("makes My Work section counts large and obvious inside each section", async () => {
    vi.setSystemTime(new Date("2026-07-08T23:30:00.000Z"));
    const rendered = await renderScreen("my-work");

    const countBadges = rendered.root.findAll(
      (node) =>
        String(node.type) === "Text" &&
        /^\d+$/.test(node.children.join("")) &&
        node.props.style?.minWidth >= 56,
    );

    expect(countBadges).toHaveLength(6);
    for (const badge of countBadges) {
      expect(badge.props.style).toMatchObject({
        fontSize: 34,
        textAlign: "center",
      });
    }
  });

  it("counts unique actionable Helpdesk requests as assigned work", () => {
    const helpdeskJob = MOBILE_JOB_FIXTURES.find(
      (job) => job.id === "firewall-riley",
    );
    const outlookEvent = MOBILE_JOB_FIXTURES.find(
      (job) => job.id === "outlook-block-riley",
    );

    if (!helpdeskJob || !outlookEvent) {
      throw new Error("Assigned-work fixtures are required.");
    }

    const sections = buildMyWorkSections(
      [
        helpdeskJob,
        {
          ...helpdeskJob,
          id: "firewall-riley-follow-up-booking",
          startAt: "2026-07-10T09:00:00+10:00",
        },
        outlookEvent,
      ],
      "2026-07-09",
    );
    const assigned = sections.find(
      (section) => section.title === "Assigned to me",
    );

    expect(assigned?.jobs).toEqual([helpdeskJob]);
  });

  it("offers an explicit take-and-schedule flow for an unassigned request", async () => {
    const source = MOBILE_JOB_FIXTURES.find((job) => job.id === "firewall-riley");
    if (!source) throw new Error("Unassigned request fixture is required.");
    const request = { ...source, id: "unassigned-request-301", requestNumber: "REQ-100301" };
    const repository = new MockTechnicianRepository({
      staffEmail: riley.email,
      unassignedJobs: [request],
    });
    const rendered = await renderScreen("unassigned", repository);

    expect(textValues(rendered)).toContain("Unassigned");
    expect(textValues(rendered)).toContain("REQ-100301");
    const takeButton = rendered.root.find(
      (node) => node.props.accessibilityLabel === "Take and schedule REQ-100301",
    );
    await act(async () => {
      takeButton.props.onPress();
    });
    expect(textValues(rendered)).toContain("Take job and confirm schedule");

    const confirmButton = rendered.root.find(
      (node) => node.props.accessibilityLabel === "Confirm schedule for REQ-100301",
    );
    await act(async () => {
      confirmButton.props.onPress();
      await Promise.resolve();
    });
    expect(textValues(rendered)).toContain("REQ-100301 scheduled to your work.");
    expect(textValues(rendered)).toContain("Queue is clear");
  });
});

function createScheduleOnlyRepository(
  listSchedule: TechnicianRepository["listSchedule"],
): TechnicianRepository {
  const unavailable = async () => {
    throw new Error("Not needed for this schedule screen test.");
  };

  return {
    addPart: unavailable,
    attachEvidence: unavailable,
    completeJob: unavailable,
    getCurrentStaff: async () => riley,
    getJob: unavailable,
    listSchedule,
    listUnassignedJobs: async () => [],
    scheduleUnassignedJob: unavailable,
    saveSignOff: unavailable,
    saveWorklog: unavailable,
    startTimer: unavailable,
    stopTimer: unavailable,
    updateStatus: unavailable,
  } as TechnicianRepository;
}

import {
  Fragment,
  createElement,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MyWorkRoute from "../../../app/(tabs)/my-work";
import TodayRoute from "../../../app/(tabs)/today";
import {
  AppProviders,
  type TechnicianSession,
} from "../../providers/app-providers";
import { MOBILE_STAFF_FIXTURES } from "../../testing/fixtures";

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
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

async function renderScreen(screen: "today" | "my-work") {
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
        <AppProviders initialSession={approvedRileySession}>
          {screen === "today" ? <TodayRoute /> : <MyWorkRoute />}
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

  it("groups My Work into operational workload sections", async () => {
    vi.setSystemTime(new Date("2026-07-08T23:30:00.000Z"));
    const rendered = await renderScreen("my-work");
    const texts = textValues(rendered);

    expect(texts).toContain("Today");
    expect(texts).toContain("Upcoming");
    expect(texts).toContain("Assigned to me");
    expect(texts).toContain("SLA risk");
    expect(texts).toContain("Waiting on me");
    expect(texts).toContain("Recently completed");
    expect(texts).toContain("Remote payroll support");
    expect(texts).not.toContain("File server disk expansion");
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
});

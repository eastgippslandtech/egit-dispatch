import {
  Fragment,
  createElement,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

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
  it("shows only Riley's chronological jobs for the selected day", async () => {
    const rendered = await renderScreen("today");

    expect(indexOfText(rendered, "Firewall firmware window")).toBeLessThan(
      indexOfText(rendered, "Internal operations meeting"),
    );
    expect(textValues(rendered)).not.toContain("File server disk expansion");
  });

  it("labels Outlook-only events as read-only", async () => {
    const rendered = await renderScreen("today");

    expect(textValues(rendered)).toContain("Outlook Read Only");
    expect(textValues(rendered)).toContain(
      "This Outlook event is not linked to a helpdesk request.",
    );
  });

  it("groups My Work into operational workload sections", async () => {
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
});

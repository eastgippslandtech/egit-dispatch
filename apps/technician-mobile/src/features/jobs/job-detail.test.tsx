import { Fragment, createElement, type PropsWithChildren } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockTechnicianRepository } from "../../data/mock-technician-repository";
import type { TechnicianRepository } from "../../data/technician-repository";
import { AppProviders } from "../../providers/app-providers";
import { MOBILE_STAFF_FIXTURES } from "../../testing/fixtures";
import type { MobileStaff } from "../../contracts/mobile";

import { JobDetail } from "./job-detail";
import { createNativeActions } from "./native-actions";

vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Linking: {
    canOpenURL: vi.fn(async (url: string) => !url.includes("blocked")),
    openURL: vi.fn(async () => undefined),
  },
  Pressable: "Pressable",
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

const rileyFixture = MOBILE_STAFF_FIXTURES.find(
  (staff) => staff.email === "riley@egit.com.au",
) as MobileStaff | undefined;

if (!rileyFixture) {
  throw new Error("Riley fixture is required.");
}

const riley: MobileStaff = rileyFixture;

async function renderJobDetail(
  jobId: string,
  repository: TechnicianRepository = new MockTechnicianRepository({
    staffEmail: "riley@egit.com.au",
  }),
) {
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
        <AppProviders
          initialSession={{ status: "approved", staff: riley }}
          repository={repository}
        >
          <JobDetail jobId={jobId} />
        </AppProviders>,
      );
      await Promise.resolve();
    });
  } finally {
    consoleError.mockRestore();
  }

  if (!rendered) {
    throw new Error("Job detail did not render.");
  }
  return rendered;
}

function textValues(rendered: ReactTestRenderer) {
  return rendered.root
    .findAll((node) => String(node.type) === "Text")
    .map((node) => node.children.join(""));
}

function button(rendered: ReactTestRenderer, label: string) {
  return rendered.root.findAll(
    (node) =>
      node.props.accessibilityRole === "button" &&
      node.props.accessibilityLabel === label,
  )[0];
}

async function pressButton(rendered: ReactTestRenderer, label: string) {
  await act(async () => {
    button(rendered, label).props.onPress();
    await Promise.resolve();
  });
}

describe("job detail", () => {
  beforeEach(() => {
    secureStore.values.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("disables write actions for Outlook-only events", async () => {
    const rendered = await renderJobDetail("outlook-block-riley");

    expect(textValues(rendered)).toContain("Outlook Read Only");
    expect(button(rendered, "Start timer").props.disabled).toBe(true);
    expect(button(rendered, "Complete job").props.disabled).toBe(true);
  });

  it("offers call and maps only when contact data exists", async () => {
    const rendered = await renderJobDetail("firewall-riley");

    expect(button(rendered, "Call contact").props.disabled).toBe(false);
    expect(button(rendered, "Open in Maps").props.disabled).toBe(false);
  });

  it("stops a timer restored after the app was closed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T01:00:00.000Z"));
    const firstOpen = await renderJobDetail("firewall-riley");

    await pressButton(firstOpen, "Start timer");
    act(() => {
      firstOpen.unmount();
    });

    vi.setSystemTime(new Date("2026-07-12T01:16:10.000Z"));
    const reopened = await renderJobDetail("firewall-riley");

    expect(textValues(reopened)).toContain("Timer running");

    await pressButton(reopened, "Stop timer");

    expect(textValues(reopened)).toContain("Timer stopped: 30 minutes queued");
  });
});

describe("native job actions", () => {
  it("checks the target URL before opening native apps", async () => {
    const actions = createNativeActions();

    await expect(actions.openPhone("+61 400 100 241")).resolves.toBe(true);
    await expect(actions.openOutlookEvent(null)).resolves.toBe(false);
  });
});

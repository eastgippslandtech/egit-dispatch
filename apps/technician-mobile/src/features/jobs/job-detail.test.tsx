import { Fragment, createElement, type PropsWithChildren } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockTechnicianRepository } from "../../data/mock-technician-repository";
import type { TechnicianRepository } from "../../data/technician-repository";
import { AppProviders } from "../../providers/app-providers";
import {
  ActiveTimerProvider,
  GlobalTimerBanner,
} from "../timer/active-timer-provider";
import { MOBILE_JOB_FIXTURES, MOBILE_STAFF_FIXTURES } from "../../testing/fixtures";
import type { MobileJob, MobileStaff } from "../../contracts/mobile";

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
  useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 59 }),
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
          <ActiveTimerProvider repository={repository}>
            <GlobalTimerBanner now={new Date()} />
            <JobDetail jobId={jobId} />
          </ActiveTimerProvider>
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

  it("shows the real request description and latest ticket notes", async () => {
    const job: MobileJob = {
      ...MOBILE_JOB_FIXTURES[0],
      description:
        "Real Command Centre database request description for VPN outage.",
      previousNotes: [
        {
          id: "db-note-latest",
          localId: null,
          visibility: "external",
          body: "Latest ticket note from the Command Centre database.",
          authorName: "Command Centre",
          createdAt: "2026-07-14T01:15:00.000Z",
          updatedAt: "2026-07-14T01:15:00.000Z",
          syncState: "synced",
          canEdit: false,
          canDelete: false,
        },
      ],
    };
    const repository = new MockTechnicianRepository({
      jobs: [job],
      staffEmail: "riley@egit.com.au",
    });

    const rendered = await renderJobDetail(job.id, repository);

    expect(textValues(rendered)).toContain(
      "Description: Real Command Centre database request description for VPN outage.",
    );
    expect(textValues(rendered)).toContain("Latest ticket notes");
    expect(textValues(rendered)).toContain(
      "Latest ticket note from the Command Centre database.",
    );
  });

  it("shows latest job information before native work log entry and defaults visibility to customer-facing", async () => {
    const job: MobileJob = {
      ...MOBILE_JOB_FIXTURES[0],
      bookingType: "Onsite",
      contactName: "Alex Morgan",
      customerName: "Gippsland Legal",
      description: "Investigate VPN outage.",
      previousNotes: [
        {
          id: "latest-note",
          localId: null,
          visibility: "external",
          body: "Customer confirmed VPN still drops.",
          authorName: "Command Centre",
          createdAt: "2026-07-14T01:15:00.000Z",
          updatedAt: "2026-07-14T01:15:00.000Z",
          syncState: "synced",
          canEdit: false,
          canDelete: false,
        },
      ],
      priority: "High",
      requestNumber: "REQ-100900",
      siteAddress: "14 Main Street, Bairnsdale VIC 3875",
      siteName: "Bairnsdale Office",
      slaDueAt: "2026-07-14T17:00:00.000Z",
      status: "Scheduled",
      title: "VPN outage follow-up",
    };
    const repository = new MockTechnicianRepository({
      jobs: [job],
      staffEmail: "riley@egit.com.au",
    });

    const rendered = await renderJobDetail(job.id, repository);
    const text = textValues(rendered);

    expect(text.indexOf("Latest job information")).toBeLessThan(
      text.indexOf("Work Log notes"),
    );
    expect(text).toContain("Work Log");
    expect(text).toContain("Request number: REQ-100900");
    expect(text).toContain("Subject: VPN outage follow-up");
    expect(text).toContain("Customer/site: Gippsland Legal / Bairnsdale Office");
    expect(text).toContain("Status: Scheduled");
    expect(text).toContain("Priority: High");
    expect(text).toContain("Technician: Riley");
    expect(text).toContain("Booking type: Onsite");
    expect(text).toContain("Contact: Alex Morgan");
    expect(text).toContain("Site/address: 14 Main Street, Bairnsdale VIC 3875");
    expect(text).toContain("Current/latest notes: Customer confirmed VPN still drops.");
    expect(text).toContain("Customer-facing");
    expect(text).toContain("Internal");

    const customerFacing = rendered.root.findAll(
      (node) => node.props.accessibilityLabel === "Customer-facing",
    )[0];
    expect(customerFacing.props.accessibilityState).toMatchObject({
      selected: true,
    });
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

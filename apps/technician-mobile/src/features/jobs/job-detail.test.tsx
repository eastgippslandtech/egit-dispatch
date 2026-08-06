import { Fragment, createElement, type PropsWithChildren } from "react";
import { Alert, Linking } from "react-native";
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
  RefreshControl: "RefreshControl",
  ScrollView: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) =>
    createElement("ScrollView", props, children),
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
    await button(rendered, label).props.onPress();
    await Promise.resolve();
  });
}

describe("job detail", () => {
  beforeEach(() => {
    secureStore.values.clear();
    vi.mocked(Alert.alert).mockClear();
    vi.mocked(Linking.openURL).mockClear();
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

  it("shows the complete request description and labelled job activity", async () => {
    const job: MobileJob = {
      ...MOBILE_JOB_FIXTURES[0],
      description:
        "Real Command Centre database request description for VPN outage.",
      previousNotes: [
        {
          id: "worklog-latest",
          localId: null,
          kind: "worklog",
          visibility: "external",
          body: "Reconfigured the VPN policy and confirmed connectivity.",
          authorName: "Riley",
          createdAt: "2026-07-14T04:00:00.000Z",
          updatedAt: "2026-07-14T04:00:00.000Z",
          durationMinutes: 45,
          isBillable: true,
          syncState: "synced",
          canEdit: false,
          canDelete: false,
        },
        {
          id: "internal-note",
          localId: null,
          kind: "internal_note",
          visibility: "internal",
          body: "Replacement firewall prepared in the workshop.",
          authorName: "Simeon",
          createdAt: "2026-07-14T03:00:00.000Z",
          updatedAt: "2026-07-14T03:00:00.000Z",
          durationMinutes: null,
          isBillable: null,
          syncState: "synced",
          canEdit: false,
          canDelete: false,
        },
        {
          id: "db-note-latest",
          localId: null,
          kind: "customer_reply",
          visibility: "external",
          body: "Latest ticket note from the Command Centre database.",
          authorName: "Command Centre",
          createdAt: "2026-07-14T01:15:00.000Z",
          updatedAt: "2026-07-14T01:15:00.000Z",
          durationMinutes: null,
          isBillable: null,
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
      "Real Command Centre database request description for VPN outage.",
    );
    const text = textValues(rendered);
    expect(text).toContain("Request description");
    expect(text).toContain("Job activity");
    expect(text).toContain("Customer reply");
    expect(text).toContain("Internal note");
    expect(text).toContain("Work Log");
    expect(text).toContain("Riley · 14 July 2026 at 2:00 pm · 45 min · Billable");
    expect(text).toContain(
      "Latest ticket note from the Command Centre database.",
    );
    expect(text.indexOf("Reconfigured the VPN policy and confirmed connectivity.")).toBeLessThan(
      text.indexOf("Replacement firewall prepared in the workshop."),
    );
    expect(text.indexOf("Replacement firewall prepared in the workshop.")).toBeLessThan(
      text.indexOf("Latest ticket note from the Command Centre database."),
    );
  });

  it("renders a legacy cached note without the new activity metadata", async () => {
    const job: MobileJob = {
      ...MOBILE_JOB_FIXTURES[0],
      previousNotes: [
        {
          id: "legacy-note",
          localId: null,
          visibility: "external",
          body: "Legacy cached customer update.",
          authorName: "Customer",
          createdAt: "2026-07-14T01:00:00.000Z",
          updatedAt: "2026-07-14T01:00:00.000Z",
          syncState: "synced",
          canEdit: false,
          canDelete: false,
        } as unknown as MobileJob["previousNotes"][number],
      ],
    };
    const repository = new MockTechnicianRepository({
      jobs: [job],
      staffEmail: "riley@egit.com.au",
    });

    const rendered = await renderJobDetail(job.id, repository);

    expect(textValues(rendered)).toContain("Customer reply");
    expect(textValues(rendered)).toContain("Legacy cached customer update.");
  });

  it("keeps saved job activity visible when pull-to-refresh fails", async () => {
    const job = MOBILE_JOB_FIXTURES[0];
    const repository = new MockTechnicianRepository({
      jobs: [job],
      staffEmail: "riley@egit.com.au",
    });
    const getJob = vi
      .spyOn(repository, "getJob")
      .mockResolvedValueOnce(job)
      .mockRejectedValueOnce(new Error("offline"));
    const rendered = await renderJobDetail(job.id, repository);
    const scrollView = rendered.root.findAll(
      (node) => String(node.type) === "ScrollView",
    )[0];
    if (!scrollView) {
      throw new Error("Job detail ScrollView was not rendered.");
    }

    await act(async () => {
      await scrollView.props.refreshControl.props.onRefresh();
    });

    expect(getJob).toHaveBeenCalledTimes(2);
    expect(textValues(rendered)).toContain(job.title);
    expect(textValues(rendered)).toContain(
      "Could not refresh job activity. Showing the saved copy.",
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
          kind: "customer_reply",
          visibility: "external",
          body: "Customer confirmed VPN still drops.",
          authorName: "Command Centre",
          createdAt: "2026-07-14T01:15:00.000Z",
          updatedAt: "2026-07-14T01:15:00.000Z",
          durationMinutes: null,
          isBillable: null,
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

  it("shows Take payment on the native job detail screen and opens EGIT Payments with job context", async () => {
    const job: MobileJob = {
      ...MOBILE_JOB_FIXTURES[0],
      customerName: "East Gippsland Health & Tech / Bairnsdale #1",
      requestNumber: "REQ/100 284",
    };
    const repository = new MockTechnicianRepository({
      jobs: [job],
      staffEmail: "riley@egit.com.au",
    });

    const rendered = await renderJobDetail(job.id, repository);

    expect(button(rendered, "Take payment").props.disabled).toBe(false);

    await pressButton(rendered, "Take payment");

    expect(Linking.openURL).toHaveBeenCalledWith(
      "egitpayments://take-payment?jobNumber=REQ%2F100+284&customerName=East+Gippsland+Health+%26+Tech+%2F+Bairnsdale+%231",
    );
  });

  it("disables Take payment when required payment context is missing", async () => {
    const job: MobileJob = {
      ...MOBILE_JOB_FIXTURES[0],
      customerName: null,
      requestNumber: "REQ-100301",
    };
    const repository = new MockTechnicianRepository({
      jobs: [job],
      staffEmail: "riley@egit.com.au",
    });

    const rendered = await renderJobDetail(job.id, repository);

    expect(button(rendered, "Take payment").props.disabled).toBe(true);
    expect(textValues(rendered)).toContain(
      "Payment needs a request number and customer name before it can open EGIT Payments.",
    );
  });

  it("shows a friendly message when EGIT Payments is unavailable", async () => {
    vi.mocked(Linking.openURL).mockRejectedValueOnce(
      new Error("No app can open this URL"),
    );
    const rendered = await renderJobDetail("firewall-riley");

    await pressButton(rendered, "Take payment");

    expect(Alert.alert).toHaveBeenCalledWith(
      "Payments app unavailable",
      "Install or update the EGIT Payments app, then try again.",
    );
  });

  it("ignores rapid repeated Take payment taps without showing an unavailable alert", async () => {
    vi.mocked(Linking.openURL).mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 5)),
    );
    const rendered = await renderJobDetail("firewall-riley");
    const takePayment = button(rendered, "Take payment");

    await act(async () => {
      const firstTap = takePayment.props.onPress();
      const secondTap = takePayment.props.onPress();
      await secondTap;
      await firstTap;
    });

    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
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

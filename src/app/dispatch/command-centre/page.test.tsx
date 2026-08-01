import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { getDispatchDesignMockData } from "@/server/dispatch/mock-data";
import { getTestSyncedDispatchDashboardData } from "@/server/dispatch/test-sync-dashboard";
import type { DispatchRequest } from "@/server/dispatch/types";

import CommandCentrePage from "./page";
import {
  bookingCardPriorityClass,
  requestNotesSummary,
  ScheduleConfirmModal,
} from "./prototype";

const routerRefreshMock = vi.fn();

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

vi.mock("@/server/dispatch/test-sync-dashboard", () => ({
  getTestSyncedDispatchDashboardData: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

const getCommandCentreAccessMock = vi.mocked(getCommandCentreAccess);
const getTestSyncedDispatchDashboardDataMock = vi.mocked(
  getTestSyncedDispatchDashboardData,
);

beforeEach(() => {
  routerRefreshMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-08T02:00:00Z"));
  getCommandCentreAccessMock.mockResolvedValue({
    status: "approved",
    accessLevel: "staff",
    email: "simeon@egit.com.au",
    name: "Simeon",
  });
  getTestSyncedDispatchDashboardDataMock.mockResolvedValue(
    getDispatchDesignMockData(),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("renders the locked Command Centre prototype with shared mock data", async () => {
  render(await CommandCentrePage());

  expect(screen.getByRole("main")).toHaveAttribute("data-density", "compact");
  expect(
    screen.getByRole("heading", { level: 1, name: "Command Centre" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Dispatch Health")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Unscheduled/ })).toBeInTheDocument();
  expect(screen.getByText("SLA Risk")).toBeInTheDocument();
  expect(screen.getByText("Double Bookings")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /More Health/ })).toBeInTheDocument();
  expect(screen.getByText("Schedule")).toBeInTheDocument();
  expect(screen.getByText("Request")).toBeInTheDocument();
  expect(screen.getByText("9:00 AM - 5:00 PM")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Wallboard" })).toHaveAttribute(
    "href",
    "/wallboard",
  );
  expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  expect(screen.getByTestId("timeline-viewport")).toHaveClass("overflow-hidden");
  expect(screen.getByTestId("timeline-viewport")).not.toHaveClass("overflow-auto");
});

test("live scheduling lets the dispatcher choose the booking type", () => {
  const data = getDispatchDesignMockData();
  const onBookingTypeChange = vi.fn();
  const onDurationChange = vi.fn();

  render(
    <ScheduleConfirmModal
      liveSchedule
      pending={{
        bookingType: "Onsite",
        date: "2026-08-04",
        durationMinutes: 60,
        end: "11:15",
        kind: "request",
        requestId: data.requests[0].id,
        start: "10:00",
        technicianId: data.technicians[0].id,
        warnings: [],
      }}
      request={data.requests[0]}
      technicians={data.technicians}
      onBookingTypeChange={onBookingTypeChange}
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
      onDurationChange={onDurationChange}
      onStartChange={vi.fn()}
      onTechnicianChange={vi.fn()}
    />,
  );

  expect(screen.getByText("Confirm live schedule")).toBeInTheDocument();
  expect(screen.getByText("MSP Central + Outlook")).toBeInTheDocument();
  expect(screen.getByText("Includes 15 minutes for onsite notes.")).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "15 minutes" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "45 minutes" })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Job duration"), {
    target: { value: "45" },
  });
  expect(onDurationChange).toHaveBeenCalledWith(45);

  fireEvent.change(screen.getByLabelText("Booking type"), {
    target: { value: "Remote" },
  });
  expect(onBookingTypeChange).toHaveBeenCalledWith("Remote");
});

test("redirects a wallboard-only session to the wallboard", async () => {
  getCommandCentreAccessMock.mockResolvedValue({
    name: "Command Centre Wallboard",
    status: "wallboard-only",
  });

  await expect(CommandCentrePage()).rejects.toThrow(
    "NEXT_REDIRECT:/wallboard",
  );
});

test("does not crash when a live request contains an invalid due date", async () => {
  const data = getDispatchDesignMockData();
  getTestSyncedDispatchDashboardDataMock.mockResolvedValueOnce({
    ...data,
    requests: data.requests.map((request, index) =>
      index === 0 ? { ...request, dueAt: "[object Object]" } : request,
    ),
    selectedRequestId: data.requests[0].id,
  });

  const page = await CommandCentrePage();

  expect(() => render(page)).not.toThrow();
  expect(
    screen.getByRole("heading", { level: 1, name: "Command Centre" }),
  ).toBeInTheDocument();
});

test("shows open unscheduled MSP Central requests without a ready-to-book flag", async () => {
  const data = getDispatchDesignMockData();
  const openRequest = {
    ...data.requests[0],
    id: "live-open-request",
    readyToBook: false,
    scheduledEnd: undefined,
    scheduledStart: undefined,
    sourceSystem: "msp-central" as const,
    status: "Open" as const,
    subject: "New live Helpdesk request",
  };
  getTestSyncedDispatchDashboardDataMock.mockResolvedValueOnce({
    ...data,
    requests: [openRequest],
    selectedRequestId: openRequest.id,
  });

  render(await CommandCentrePage());

  expect(
    within(screen.getByTestId("request-queue")).getByText(
      "New live Helpdesk request",
    ),
  ).toBeInTheDocument();
});

test("keeps billing state and unknown site placeholders out of queue cards", async () => {
  const data = getDispatchDesignMockData();
  const request = {
    ...data.requests[0],
    billable: false,
    id: "live-request-without-site",
    scheduledEnd: undefined,
    scheduledStart: undefined,
    site: "Unknown site",
    sourceSystem: "msp-central" as const,
    status: "Open" as const,
  };
  getTestSyncedDispatchDashboardDataMock.mockResolvedValueOnce({
    ...data,
    requests: [request],
    selectedRequestId: request.id,
  });

  render(await CommandCentrePage());

  const queue = screen.getByTestId("request-queue");
  expect(within(queue).queryByText("Billable")).not.toBeInTheDocument();
  expect(within(queue).queryByText("Non-billable")).not.toBeInTheDocument();
  expect(within(queue).queryByText("Unknown site")).not.toBeInTheDocument();
});

test("maps booking urgency to full-card priority colours", () => {
  expect(bookingCardPriorityClass("Critical")).toContain("bg-rose");
  expect(bookingCardPriorityClass("High")).toContain("bg-amber");
  expect(bookingCardPriorityClass("Medium")).toContain("bg-emerald");
  expect(bookingCardPriorityClass("Low")).toContain("bg-sky");
  expect(bookingCardPriorityClass(null)).toContain("bg-slate");
});

test("does not show mock notes for live MSP Central requests", () => {
  expect(
    requestNotesSummary({
      sourceSystem: "msp-central",
    } as DispatchRequest),
  ).toBe("No notes provided.");
});

test("week planner keeps technician rows compact and reveals overflow jobs", async () => {
  render(await CommandCentrePage());

  fireEvent.click(screen.getByRole("button", { name: "week" }));

  const viewport = screen.getByTestId("week-calendar-viewport");
  expect(viewport).toHaveClass("overflow-hidden");
  expect(screen.getByText("Riley")).toBeInTheDocument();
  expect(screen.getByText("Simeon")).toBeInTheDocument();

  const jervyWednesday = screen.getByTestId("week-cell-tech-jervy-2026-07-08");
  expect(within(jervyWednesday).getAllByTestId("week-appointment-card")).toHaveLength(1);

  const moreButton = within(jervyWednesday).getByRole("button", {
    name: /Show 1 more Jervy bookings on Wed, 8 July/,
  });
  expect(moreButton).toHaveTextContent("+1");

  fireEvent.click(moreButton);

  const reveal = screen.getByTestId("week-overflow-reveal");
  expect(within(reveal).getByText("Jervy · Wed, 8 July")).toBeInTheDocument();
  expect(within(reveal).getAllByTestId("week-overflow-appointment")).toHaveLength(2);
});

test("renders an obvious current-time line and elapsed-day shade in day view", async () => {
  render(await CommandCentrePage());

  expect(screen.getByText("Now")).toBeInTheDocument();

  const elapsedShades = screen.getAllByTestId("current-time-elapsed-shade");
  expect(elapsedShades.length).toBeGreaterThan(0);
  expect(elapsedShades[0]).toHaveClass("bg-cc-orange/[0.14]");
  expect(elapsedShades[0]).toHaveClass("z-[2]");

  const currentTimeLines = screen.getAllByTestId("current-time-line");
  expect(currentTimeLines.length).toBeGreaterThan(0);
  expect(currentTimeLines[0]).toHaveClass("w-0.5");
  expect(currentTimeLines[0]).toHaveClass("z-[12]");
});

test("updates the detail drawer from queue and appointment selections", async () => {
  render(await CommandCentrePage());

  fireEvent.click(
    screen.getByRole("button", {
      name: /REQ-100301 Finance workstation replacement/,
    }),
  );

  const drawer = screen.getByTestId("command-centre-drawer");
  expect(within(drawer).getByText("REQ-100301")).toBeInTheDocument();
  expect(
    within(drawer).getByText("Finance workstation replacement"),
  ).toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("button", {
      name: /File server disk expansion OneHarvest/,
    }),
  );

  expect(within(drawer).getByText("REQ-100211")).toBeInTheDocument();
  expect(
    within(drawer).getAllByText("File server disk expansion").length,
  ).toBeGreaterThan(0);
});

test("shows ticket update indicators and marks an update seen when selected", async () => {
  render(await CommandCentrePage());

  expect(screen.getByTestId("queue-ticket-update-100317")).toHaveTextContent(
    "Updated",
  );
  expect(screen.getByTestId("timeline-ticket-update-appt-1")).toHaveTextContent(
    "Updated",
  );

  fireEvent.click(
    screen.getByRole("button", {
      name: /REQ-100317 POS terminal intermittent dropouts/,
    }),
  );

  expect(
    screen.queryByTestId("queue-ticket-update-100317"),
  ).not.toBeInTheDocument();

  const drawer = screen.getByTestId("command-centre-drawer");
  expect(within(drawer).getByText("Ticket update")).toBeInTheDocument();
  expect(within(drawer).getByText("Notes added")).toBeInTheDocument();
  expect(
    within(drawer).getByText("Customer confirmed the POS dropouts are still happening."),
  ).toBeInTheDocument();
});

test("disables unavailable Helpdesk and Outlook writeback actions honestly", async () => {
  render(await CommandCentrePage());

  const drawer = screen.getByTestId("command-centre-drawer");

  expect(within(drawer).getByRole("button", { name: "Open in Helpdesk" })).toBeDisabled();
  expect(within(drawer).getByRole("button", { name: "Open in Helpdesk" })).toHaveAttribute(
    "title",
    "MSP Central request URL is not configured yet.",
  );
  expect(within(drawer).getByRole("button", { name: "Reschedule" })).toBeDisabled();
  expect(within(drawer).getByRole("button", { name: "Reschedule" })).toHaveAttribute(
    "title",
    "MSP Central API access is not configured yet.",
  );
  expect(
    within(drawer).getByRole("button", {
      name: "Create / Update Calendar Event",
    }),
  ).toBeDisabled();
  expect(
    within(drawer).getByRole("button", {
      name: "Create / Update Calendar Event",
    }),
  ).toHaveAttribute(
    "title",
    "Select a linked scheduled request while Outlook writeback is enabled.",
  );
});

test("opens a Work Log modal from the drawer with latest job information and customer-facing visibility", async () => {
  render(await CommandCentrePage());

  const drawer = screen.getByTestId("command-centre-drawer");
  fireEvent.click(within(drawer).getByRole("button", { name: "Work Log" }));

  const dialog = screen.getByRole("dialog", { name: "Work Log" });
  expect(dialog).toHaveAttribute("data-layout", "full-screen-split");
  expect(within(dialog).getByRole("region", { name: "Ticket information" })).toBeInTheDocument();
  expect(within(dialog).getByRole("region", { name: "Work Log entry" })).toBeInTheDocument();
  expect(within(dialog).getByRole("heading", { name: "Work Log" })).toBeInTheDocument();
  expect(within(dialog).getByText("Latest job information")).toBeInTheDocument();
  expect(within(dialog).getByText("Request number")).toBeInTheDocument();
  expect(within(dialog).getByText("REQ-100284")).toBeInTheDocument();
  expect(within(dialog).getByText("Packhouse label printer offline")).toBeInTheDocument();
  expect(within(dialog).getByText("Customer/site")).toBeInTheDocument();
  expect(within(dialog).getByText("Status")).toBeInTheDocument();
  expect(within(dialog).getByText("Priority")).toBeInTheDocument();
  expect(within(dialog).getByText("Technician")).toBeInTheDocument();
  expect(within(dialog).getByText("Scheduled time")).toBeInTheDocument();
  expect(within(dialog).getByText("Due time")).toBeInTheDocument();
  expect(within(dialog).getByText("Contact")).toBeInTheDocument();
  expect(within(dialog).getByText("Site/address")).toBeInTheDocument();
  expect(within(dialog).getByText("Job description")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Customer-facing")).toBeChecked();
  expect(within(dialog).getByLabelText("Internal")).not.toBeChecked();
  expect(within(dialog).getByLabelText("Work Log notes")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Time spent")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Work type")).toBeInTheDocument();
  expect(within(dialog).queryByRole("checkbox", { name: "Billable" })).not.toBeInTheDocument();
  expect(within(dialog).getByLabelText("Internal")).toBeDisabled();
  expect(within(dialog).queryByText("Outcome")).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Save Work Log" })).toBeInTheDocument();
});

test("keeps Work Log billing and visibility combinations valid", async () => {
  render(await CommandCentrePage());

  fireEvent.click(
    within(screen.getByTestId("command-centre-drawer")).getByRole("button", {
      name: "Work Log",
    }),
  );

  const dialog = screen.getByRole("dialog", { name: "Work Log" });
  const workType = within(dialog).getByLabelText("Work type");
  const customerFacing = within(dialog).getByLabelText("Customer-facing");
  const internal = within(dialog).getByLabelText("Internal");

  expect(customerFacing).toBeChecked();
  expect(internal).toBeDisabled();

  fireEvent.change(workType, { target: { value: "internal" } });
  expect(internal).toBeChecked();
  expect(customerFacing).toBeDisabled();

  fireEvent.change(workType, { target: { value: "non_billable" } });
  expect(customerFacing).not.toBeDisabled();
  expect(internal).not.toBeDisabled();
});

test("loads the latest job description and customer responses into a live Work Log", async () => {
  vi.useRealTimers();
  const data = getDispatchDesignMockData();
  const selectedRequest = data.requests[0];
  getTestSyncedDispatchDashboardDataMock.mockResolvedValueOnce({
    ...data,
    dispatchDataSource: "msp-central",
    requests: data.requests.map((request) => ({
      ...request,
      sourceSystem: "msp-central",
    })),
    selectedRequestId: selectedRequest.id,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      json: async () => ({
        customerResponses: [
          {
            author: "Mel Harris",
            body: "Labels are no longer printing at all.",
            createdAt: "2026-07-08T01:30:00.000Z",
            id: "response-1",
          },
        ],
        internalNotes: [
          {
            author: "Simeon",
            body: "Confirm access before dispatch.",
            createdAt: "2026-07-08T01:45:00.000Z",
            id: "note-1",
          },
        ],
        worklogs: [
          {
            author: "Riley Pearson",
            body: "Rebuilt the legacy Outlook profile and tested mail flow.",
            createdAt: "2024-01-01T00:00:00.000Z",
            durationMinutes: 75,
            id: "legacy-worklog-1",
          },
        ],
        request: {
          ...selectedRequest,
          notes: "The Zebra label printer is offline after a power outage.",
          sourceSystem: "msp-central",
        },
      }),
      ok: true,
    })),
  );

  render(await CommandCentrePage());
  fireEvent.click(
    within(screen.getByTestId("command-centre-drawer")).getByRole("button", {
      name: "Work Log",
    }),
  );

  const dialog = screen.getByRole("dialog", { name: "Work Log" });
  expect(await within(dialog).findByText("Job description")).toBeInTheDocument();
  expect(
    within(dialog).getByText(
      "The Zebra label printer is offline after a power outage.",
    ),
  ).toBeInTheDocument();
  expect(within(dialog).getByText("Customer responses")).toBeInTheDocument();
  expect(
    within(dialog).getByText("Labels are no longer printing at all."),
  ).toBeInTheDocument();
  expect(within(dialog).getByText("Internal notes")).toBeInTheDocument();
  expect(
    within(dialog).getByText("Confirm access before dispatch."),
  ).toBeInTheDocument();
  expect(within(dialog).getByText("Previous work logs")).toBeInTheDocument();
  expect(
    within(dialog).getByText(
      "Rebuilt the legacy Outlook profile and tested mail flow.",
    ),
  ).toBeInTheDocument();
  expect(within(dialog).getByText("1h 15m")).toBeInTheDocument();
});

test("requires an outcome for a scheduled Work Log and completes the request", async () => {
  render(await CommandCentrePage());

  fireEvent.click(screen.getByTestId("timeline-appointment-appt-1"));

  fireEvent.click(
    within(screen.getByTestId("command-centre-drawer")).getByRole("button", {
      name: "Work Log",
    }),
  );

  const dialog = screen.getByRole("dialog", { name: "Work Log" });
  fireEvent.change(within(dialog).getByLabelText("Work Log notes"), {
    target: { value: "Replaced failed switch and verified labels print." },
  });
  fireEvent.change(within(dialog).getByLabelText("Time spent"), {
    target: { value: "45" },
  });
  expect(within(dialog).getByRole("button", { name: "Choose an outcome" })).toBeDisabled();
  fireEvent.click(within(dialog).getByLabelText("Complete ticket"));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Save Work Log and complete ticket" }),
  );

  const drawer = screen.getByTestId("command-centre-drawer");
  expect(within(drawer).getByText("Resolved")).toBeInTheDocument();
  expect(screen.getByText("Work Log saved and ticket resolved locally for test sync.")).toBeInTheDocument();
});

test("shows the required conditional fields for book forward and transfer", async () => {
  render(await CommandCentrePage());
  fireEvent.click(screen.getByTestId("timeline-appointment-appt-1"));
  fireEvent.click(
    within(screen.getByTestId("command-centre-drawer")).getByRole("button", {
      name: "Work Log",
    }),
  );

  const dialog = screen.getByRole("dialog", { name: "Work Log" });
  fireEvent.click(within(dialog).getByLabelText("Book forward"));
  expect(within(dialog).getByLabelText("Forward technician")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Forward date")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Forward start time")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Forward end time")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Forward booking type")).toBeInTheDocument();

  fireEvent.click(within(dialog).getByLabelText("Transfer / escalate"));
  expect(within(dialog).getByLabelText("Transfer target")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Transfer reason")).toBeInTheDocument();
  expect(within(dialog).queryByLabelText("Forward date")).not.toBeInTheDocument();
});

test("retries server data while the MSP Central unavailable warning is visible", async () => {
  const data = getDispatchDesignMockData();
  getTestSyncedDispatchDashboardDataMock.mockResolvedValueOnce({
    ...data,
    calendarError:
      "MSP Central is temporarily unavailable. Helpdesk requests could not be loaded.",
  });

  render(await CommandCentrePage());
  await vi.advanceTimersByTimeAsync(30_000);

  expect(routerRefreshMock).toHaveBeenCalledOnce();
});

test("merges the queue duplicate into a searched surviving parent after confirmation", async () => {
  vi.useRealTimers();
  const data = getDispatchDesignMockData();
  getTestSyncedDispatchDashboardDataMock.mockResolvedValueOnce({
    ...data,
    dispatchDataSource: "msp-central",
    requests: data.requests.map((request) => ({
      ...request,
      sourceSystem: "msp-central",
    })),
  });
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      childRequestId: "100284",
      ok: true,
      parentRequestId: "100301",
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  render(await CommandCentrePage());

  const queue = screen.getByTestId("request-queue");
  fireEvent.click(
    within(queue).getByRole("button", {
      name: "Merge REQ-100284",
    }),
  );

  let dialog = screen.getByRole("dialog", { name: "Merge request" });
  expect(within(dialog).getByText("Duplicate ticket")).toBeInTheDocument();
  expect(within(dialog).getByText("REQ-100284")).toBeInTheDocument();

  fireEvent.change(
    within(dialog).getByPlaceholderText("Search request number, subject or customer"),
    {
      target: { value: "Finance workstation" },
    },
  );
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Select REQ-100301 as surviving parent",
    }),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Review merge" }));

  dialog = screen.getByRole("dialog", { name: "Confirm request merge" });
  expect(within(dialog).getByText("Duplicate removed")).toBeInTheDocument();
  expect(within(dialog).getByText("Surviving parent")).toBeInTheDocument();
  expect(
    within(dialog).getByText("This merge is effectively irreversible."),
  ).toBeInTheDocument();

  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Merge duplicate into parent",
    }),
  );

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/internal/msp-central/merge-requests",
      expect.objectContaining({
        body: JSON.stringify({
          childRequestId: "100284",
          parentRequestId: "100301",
        }),
        method: "POST",
      }),
    ),
  );
  await waitFor(() =>
    expect(
      within(screen.getByTestId("request-queue")).queryByRole("button", {
        name: "REQ-100284 Packhouse label printer offline",
      }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByText("REQ-100284 merged into REQ-100301.")).toBeInTheDocument();
});

test("renders overlapping timeline appointments as an inspectable stack", async () => {
  render(await CommandCentrePage());

  const stack = screen.getByRole("button", {
    name: /2 overlapping appointments/,
  });

  expect(stack).toHaveTextContent("+1");
  expect(stack).toHaveTextContent("Overlap");

  fireEvent.mouseEnter(stack);

  const reveal = screen.getByTestId("timeline-overlap-reveal");
  expect(within(reveal).getByText("Practice management update")).toBeInTheDocument();
  expect(within(reveal).getByText("Outlook busy: supplier call")).toBeInTheDocument();
  expect(within(reveal).getByText("11:15-12:30")).toBeInTheDocument();

  fireEvent.click(
    within(reveal).getByRole("button", {
      name: /Outlook busy: supplier call/,
    }),
  );

  const drawer = screen.getByTestId("command-centre-drawer");
  expect(
    within(drawer).getByRole("heading", {
      name: "Outlook busy: supplier call",
    }),
  ).toBeInTheDocument();
});

test("keeps health cards focused on label and count", async () => {
  render(await CommandCentrePage());

  expect(
    screen.queryByText("Open requests needing a technician or schedule."),
  ).not.toBeInTheDocument();

  expect(
    screen.queryByRole("button", { name: /Missing Calendar/ }),
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /More Health/ }));
  expect(
    screen.getByRole("button", { name: /Missing Calendar/ }),
  ).toBeInTheDocument();
});

test("toggles and clears health filters", async () => {
  render(await CommandCentrePage());

  const slaRisk = screen.getByRole("button", { name: /SLA Risk/ });
  expect(slaRisk).toHaveAttribute("aria-pressed", "false");

  fireEvent.click(slaRisk);
  expect(slaRisk).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("Health filter: SLA Risk")).toBeInTheDocument();

  fireEvent.click(slaRisk);
  expect(slaRisk).toHaveAttribute("aria-pressed", "false");

  fireEvent.click(slaRisk);
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

  expect(slaRisk).toHaveAttribute("aria-pressed", "false");
});

test("filters the board from Dispatch Health cards", async () => {
  render(await CommandCentrePage());

  const queue = screen.getByTestId("request-queue");

  fireEvent.click(screen.getByRole("button", { name: /SLA Risk/ }));
  expect(within(queue).getByText("Packhouse label printer offline")).toBeInTheDocument();
  expect(within(queue).getByText("Finance workstation replacement")).toBeInTheDocument();
  expect(
    within(queue).queryByText("Microsoft 365 shared mailbox access"),
  ).not.toBeInTheDocument();
  expect(screen.getByTestId("timeline-appointment-appt-1")).toHaveAttribute(
    "data-search-state",
    "dimmed",
  );

  fireEvent.change(screen.getByPlaceholderText("Search requests"), {
    target: { value: "printer" },
  });
  expect(within(queue).getByText("Packhouse label printer offline")).toBeInTheDocument();
  expect(within(queue).queryByText("Finance workstation replacement")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /Double Bookings/ }));
  expect(screen.getByRole("button", { name: /SLA Risk/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(screen.getByRole("button", { name: /Double Bookings/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(within(queue).getByText("No requests match this health filter")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  fireEvent.click(screen.getByRole("button", { name: /Double Bookings/ }));
  expect(within(queue).getByText("Practice management update")).toBeInTheDocument();
  expect(screen.getByTestId("timeline-overlap-appt-3")).toHaveAttribute(
    "data-search-state",
    "match",
  );
  expect(screen.getByTestId("timeline-appointment-appt-1")).toHaveAttribute(
    "data-search-state",
    "dimmed",
  );
});

test("health filters cover sync, travel, out-of-hours, and More Health records", async () => {
  render(await CommandCentrePage());

  const queue = screen.getByTestId("request-queue");

  fireEvent.click(screen.getByRole("button", { name: /Sync Issues/ }));
  expect(within(queue).getByText("Practice management update")).toBeInTheDocument();
  expect(screen.getByTestId("timeline-overlap-appt-3")).toHaveAttribute(
    "data-search-state",
    "match",
  );

  fireEvent.click(screen.getByRole("button", { name: /Travel/ }));
  expect(within(queue).getByText("File server disk expansion")).toBeInTheDocument();
  expect(within(queue).getByText("Practice management update")).toBeInTheDocument();
  expect(screen.getByTestId("timeline-appointment-appt-1")).toHaveAttribute(
    "data-search-state",
    "match",
  );

  fireEvent.change(screen.getByLabelText("Select dispatch date"), {
    target: { value: "2026-07-09" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Out-of-Hours/ }));
  expect(
    within(queue).getByText("After-hours firewall firmware window"),
  ).toBeInTheDocument();
  expect(screen.getByTestId("timeline-appointment-appt-5")).toHaveAttribute(
    "data-search-state",
    "match",
  );

  fireEvent.change(screen.getByLabelText("Select dispatch date"), {
    target: { value: "2026-07-11" },
  });
  fireEvent.click(screen.getByRole("button", { name: /More Health/ }));
  fireEvent.click(screen.getByRole("button", { name: /Missing Calendar/ }));
  expect(within(queue).getByText("Scheduled job missing calendar")).toBeInTheDocument();
  expect(screen.getByTestId("timeline-appointment-appt-8")).toHaveAttribute(
    "data-search-state",
    "match",
  );
});

test("shows an empty health-filter state when no affected requests match", async () => {
  render(await CommandCentrePage());

  fireEvent.click(screen.getByRole("button", { name: /More Health/ }));
  fireEvent.click(screen.getByRole("button", { name: /All-Day Blocks/ }));

  expect(
    within(screen.getByTestId("request-queue")).getByText(
      "No requests match this health filter",
    ),
  ).toBeInTheDocument();
});

test("filters the request queue with request search", async () => {
  render(await CommandCentrePage());

  const queue = screen.getByTestId("request-queue");
  const search = screen.getByPlaceholderText("Search requests");

  fireEvent.change(search, { target: { value: "REQ-100284" } });
  expect(within(queue).getByText("Packhouse label printer offline")).toBeInTheDocument();
  expect(within(queue).queryByText("Finance workstation replacement")).not.toBeInTheDocument();
  expect(screen.getByText("1 of 15")).toBeInTheDocument();

  fireEvent.change(search, { target: { value: "Decor Floors" } });
  expect(within(queue).getByText("POS terminal intermittent dropouts")).toBeInTheDocument();
  expect(within(queue).getByText("Printer replacement and driver cleanup")).toBeInTheDocument();
  expect(within(queue).queryByText("Packhouse label printer offline")).not.toBeInTheDocument();

  fireEvent.change(search, { target: { value: "Jervy" } });
  expect(within(queue).getByText("POS terminal intermittent dropouts")).toBeInTheDocument();
  expect(within(queue).queryByText("Packhouse label printer offline")).not.toBeInTheDocument();

  fireEvent.change(search, { target: { value: "zzzz-not-real" } });
  expect(within(queue).getByText("No matching requests")).toBeInTheDocument();
});

test("filters the queue with top search and dims nonmatching appointments", async () => {
  render(await CommandCentrePage());

  const queue = screen.getByTestId("request-queue");
  const topSearch = screen.getByPlaceholderText("Search Command Centre");

  fireEvent.change(topSearch, { target: { value: "OneHarvest" } });

  expect(within(queue).getByText("Packhouse label printer offline")).toBeInTheDocument();
  expect(within(queue).queryByText("Finance workstation replacement")).not.toBeInTheDocument();

  expect(screen.getByTestId("timeline-appointment-appt-1")).toHaveAttribute(
    "data-search-state",
    "match",
  );
  expect(screen.getByTestId("timeline-overlap-appt-3")).toHaveAttribute(
    "data-search-state",
    "dimmed",
  );

  fireEvent.keyDown(topSearch, { key: "Escape" });
  expect(topSearch).toHaveValue("");
  expect(within(queue).getByText("Finance workstation replacement")).toBeInTheDocument();
});

test("combines queue filters and clears them", async () => {
  render(await CommandCentrePage());

  const queue = screen.getByTestId("request-queue");

  fireEvent.click(screen.getByRole("button", { name: /^Priority/ }));
  fireEvent.click(screen.getByRole("button", { name: "High" }));
  expect(within(queue).getByText("POS terminal intermittent dropouts")).toBeInTheDocument();
  expect(within(queue).queryByText("Finance workstation replacement")).not.toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText("Search requests"), {
    target: { value: "printer" },
  });
  expect(within(queue).queryByText("POS terminal intermittent dropouts")).not.toBeInTheDocument();
  expect(within(queue).getByText("No matching requests")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByPlaceholderText("Search requests")).toHaveValue("");
  expect(within(queue).getByText("Finance workstation replacement")).toBeInTheDocument();
});

test("technician, status, and sla risk filters update the request queue", async () => {
  render(await CommandCentrePage());

  const queue = screen.getByTestId("request-queue");

  fireEvent.click(screen.getByRole("button", { name: /^Technician/ }));
  fireEvent.click(screen.getByRole("button", { name: "Jervy" }));
  expect(within(queue).getByText("POS terminal intermittent dropouts")).toBeInTheDocument();
  expect(within(queue).queryByText("Packhouse label printer offline")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  fireEvent.click(screen.getByRole("button", { name: /^Status/ }));
  fireEvent.click(screen.getByRole("button", { name: "Needs review" }));
  expect(within(queue).getByText("Finance workstation replacement")).toBeInTheDocument();
  expect(within(queue).queryByText("Packhouse label printer offline")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  fireEvent.click(screen.getByRole("button", { name: /^SLA risk/ }));
  fireEvent.click(screen.getByRole("button", { name: "Overdue" }));
  expect(within(queue).getByText("Packhouse label printer offline")).toBeInTheDocument();
  expect(within(queue).queryByText("Finance workstation replacement")).not.toBeInTheDocument();
});

test("changes selected day with previous, next, today, and date picker controls", async () => {
  render(await CommandCentrePage());

  expect(screen.getByText("Wednesday 8 July 2026")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /File server disk expansion OneHarvest/ }),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText("Previous day"));

  expect(screen.getByText("Tuesday 7 July 2026")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Past scheduled open job Lakeside Motel/ }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", {
      name: /File server disk expansion OneHarvest/,
    }),
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getByLabelText("Next day"));
  expect(screen.getByText("Wednesday 8 July 2026")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Today" }));
  expect(screen.getByText("Wednesday 8 July 2026")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Select dispatch date"), {
    target: { value: "2026-07-09" },
  });

  expect(screen.getByText("Thursday 9 July 2026")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Firewall firmware window Decor Floors/ }),
  ).toBeInTheDocument();
});

test("shows a week planner and opens a day from the week header", async () => {
  render(await CommandCentrePage());

  fireEvent.click(screen.getByRole("button", { name: "week" }));

  expect(screen.getByText("Weekly planner")).toBeInTheDocument();
  expect(screen.getByTestId("week-calendar-viewport")).toHaveClass("overflow-hidden");
  expect(screen.getByTestId("week-calendar-viewport")).not.toHaveClass("overflow-auto");
  expect(screen.getByText("Monday Outlook hold")).toBeInTheDocument();
  expect(screen.getByText("Sunday client travel prep")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /Fri/ }));

  expect(screen.getByText("Friday 10 July 2026")).toBeInTheDocument();
  expect(screen.getByText("Technician timeline")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Network cabinet tidy East Gippsland Homes/ }),
  ).toBeInTheDocument();
});

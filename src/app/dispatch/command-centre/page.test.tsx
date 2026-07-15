import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { getDispatchDesignMockData } from "@/server/dispatch/mock-data";

import CommandCentrePage from "./page";
import { CommandCentrePrototype, bookingCardPriorityClass } from "./prototype";

vi.mock("@/server/auth/session", () => ({
  getCommandCentreAccess: vi.fn(),
}));

const getCommandCentreAccessMock = vi.mocked(getCommandCentreAccess);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-08T02:00:00Z"));
  getCommandCentreAccessMock.mockResolvedValue({
    status: "approved",
    email: "simeon@egit.com.au",
    name: "Simeon",
  });
});

afterEach(() => {
  vi.useRealTimers();
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
  expect(screen.getByText("9:00 AM - 5:30 PM")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  expect(screen.getByTestId("timeline-viewport")).toHaveClass("overflow-hidden");
  expect(screen.getByTestId("timeline-viewport")).not.toHaveClass("overflow-auto");
});

test("maps booking urgency to full-card priority colours", () => {
  expect(bookingCardPriorityClass("Critical")).toContain("bg-rose");
  expect(bookingCardPriorityClass("High")).toContain("bg-amber");
  expect(bookingCardPriorityClass("Medium")).toContain("bg-emerald");
  expect(bookingCardPriorityClass("Low")).toContain("bg-sky");
  expect(bookingCardPriorityClass(null)).toContain("bg-slate");
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

test("shows a live mobile timer counter in the selected job drawer", () => {
  const data = getDispatchDesignMockData();
  const selectedRequestId = "100284";
  render(
    <CommandCentrePrototype
      data={{
        ...data,
        selectedRequestId,
        requests: data.requests.map((request) =>
          request.id === selectedRequestId
            ? {
                ...request,
                activeTimer: {
                  id: "timer-mobile-1",
                  jobId: "mock-100284-test",
                  startedAt: "2026-07-08T01:15:00.000Z",
                  technicianId: "tech-riley",
                },
              }
            : request,
        ),
      }}
    />,
  );

  const drawer = screen.getByTestId("command-centre-drawer");
  expect(within(drawer).getByText("Active mobile timer")).toBeInTheDocument();
  expect(within(drawer).getByText("45m")).toBeInTheDocument();
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
  ).toHaveAttribute("title", "Outlook writeback is not enabled yet.");
});

test("opens a Work Log modal from the drawer with latest job information and customer-facing visibility", async () => {
  render(await CommandCentrePage());

  const drawer = screen.getByTestId("command-centre-drawer");
  fireEvent.click(within(drawer).getByRole("button", { name: "Work Log" }));

  const dialog = screen.getByRole("dialog", { name: "Work Log" });
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
  expect(within(dialog).getByText("Current/latest notes")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Customer-facing")).toBeChecked();
  expect(within(dialog).getByLabelText("Internal")).not.toBeChecked();
  expect(within(dialog).getByLabelText("Work Log notes")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Time spent")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Work type")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Billable")).toBeChecked();
  expect(within(dialog).getByRole("button", { name: "Save Work Log" })).toBeInTheDocument();
  expect(
    within(dialog).getByRole("button", { name: "Save and complete ticket" }),
  ).toBeInTheDocument();
});

test("saves Work Log locally and save-and-complete marks the request resolved", async () => {
  render(await CommandCentrePage());

  fireEvent.click(
    within(screen.getByTestId("command-centre-drawer")).getByRole("button", {
      name: "Work Log",
    }),
  );

  let dialog = screen.getByRole("dialog", { name: "Work Log" });
  fireEvent.change(within(dialog).getByLabelText("Work Log notes"), {
    target: { value: "Replaced failed switch and verified labels print." },
  });
  fireEvent.change(within(dialog).getByLabelText("Time spent"), {
    target: { value: "45" },
  });
  fireEvent.change(within(dialog).getByLabelText("Work type"), {
    target: { value: "non_billable" },
  });
  fireEvent.click(within(dialog).getByLabelText("Internal"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save Work Log" }));

  expect(screen.queryByRole("dialog", { name: "Work Log" })).not.toBeInTheDocument();
  expect(screen.getByText("Work Log saved locally for test sync.")).toBeInTheDocument();

  fireEvent.click(
    within(screen.getByTestId("command-centre-drawer")).getByRole("button", {
      name: "Work Log",
    }),
  );
  dialog = screen.getByRole("dialog", { name: "Work Log" });
  fireEvent.change(within(dialog).getByLabelText("Work Log notes"), {
    target: { value: "Ticket completed after verification." },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Save and complete ticket" }),
  );

  const drawer = screen.getByTestId("command-centre-drawer");
  expect(within(drawer).getByText("Resolved")).toBeInTheDocument();
  expect(screen.getByText("Work Log saved and ticket resolved locally for test sync.")).toBeInTheDocument();
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
  expect(screen.getByText("1 of 14")).toBeInTheDocument();

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
  expect(screen.getByTestId("dispatch-workspace")).toHaveClass("grid-cols-1");
  expect(screen.getByTestId("week-calendar-viewport")).toHaveClass("overflow-auto");
  expect(screen.getByTestId("week-calendar-viewport")).not.toHaveClass("overflow-hidden");
  expect(screen.getByText("Riley")).toBeInTheDocument();
  expect(
    screen.getAllByRole("button", { name: /\+\d+ more — open day/ }).length,
  ).toBeGreaterThan(0);
  expect(screen.getByText("Monday Outlook hold")).toBeInTheDocument();
  expect(screen.getByText("Sunday client travel prep")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /Fri/ }));

  expect(screen.getByText("Friday 10 July 2026")).toBeInTheDocument();
  expect(screen.getByText("Technician timeline")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Network cabinet tidy East Gippsland Homes/ }),
  ).toBeInTheDocument();
});

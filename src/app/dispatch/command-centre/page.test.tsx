import {
  act,
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
  CommandCentrePrototype,
  bookingCardPriorityClass,
  CreateRequestModal,
  integrationReceiptDisposition,
  MergeRequestModal,
  pendingLiveAppointmentId,
  publishLiveSchedule,
  reconcileDashboardWithPendingWritebacks,
  resolveWorkLogAppointment,
  requestNotesSummary,
  safeRequestContentParts,
  ScheduleConfirmModal,
  TicketWorkspaceModal,
  toastAutoDismissMs,
  WorkLogModal,
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

function openSelectedDrawerWorkLogTab() {
  fireEvent.click(
    within(screen.getByTestId("command-centre-drawer")).getByRole("button", {
      name: "Comms",
    }),
  );
  const workspace = screen.getByRole("dialog", { name: "Ticket workspace" });
  fireEvent.click(within(workspace).getByRole("tab", { name: "Work Log" }));
  return workspace;
}

test("renders the locked Command Centre prototype with shared mock data", async () => {
  render(await CommandCentrePage());

  expect(screen.getByRole("main")).toHaveAttribute("data-density", "compact");
  expect(
    screen.getByRole("heading", { level: 1, name: "Command Centre" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Dispatch Health")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Unscheduled 2" })).toBeInTheDocument();
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
  expect(screen.getByRole("link", { name: "Dispatch Queue" })).toHaveAttribute(
    "href",
    "/dispatch/queue",
  );
  expect(screen.getByRole("link", { name: "Integrations" })).toHaveAttribute(
    "href",
    "/integrations",
  );
  expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  expect(screen.getByTestId("timeline-viewport")).toHaveClass("overflow-y-auto");
});

test("renders a provider warning only once", () => {
  const data = getDispatchDesignMockData();
  render(
    <CommandCentrePrototype
      data={{ ...data, calendarError: "Outlook calendar is temporarily unavailable." }}
    />,
  );

  expect(
    screen.getAllByText("Outlook calendar is temporarily unavailable."),
  ).toHaveLength(1);
});

test("renders a normalized review-required warning only once in the drawer", () => {
  const data = getDispatchDesignMockData();
  const selectedRequest = data.requests[0];
  render(
    <CommandCentrePrototype
      showIntegrations
      data={{
        ...data,
        requests: data.requests.map((request) =>
          request.id === selectedRequest.id
            ? { ...request, warnings: ["Review required", "review required", "SLA risk"] }
            : request,
        ),
        selectedRequestId: selectedRequest.id,
      }}
    />,
  );

  expect(
    within(screen.getByLabelText("Selected request warnings")).getAllByText(/review required/i),
  ).toHaveLength(1);
});

test("identifies a site address supplied by Zoho CRM in the request drawer", () => {
  const data = getDispatchDesignMockData();
  const selectedRequest = data.requests[0];
  render(
    <CommandCentrePrototype
      data={{
        ...data,
        requests: data.requests.map((request) =>
          request.id === selectedRequest.id
            ? {
                ...request,
                siteAddress: "42 Raymond Street, Sale VIC 3850",
                siteAddressSource: "zoho-crm",
              }
            : request,
        ),
        selectedRequestId: selectedRequest.id,
      }}
    />,
  );

  const drawer = within(screen.getByTestId("command-centre-drawer"));
  expect(
    drawer.getAllByText("42 Raymond Street, Sale VIC 3850").length,
  ).toBeGreaterThan(0);
  expect(drawer.getByText("Zoho CRM")).toBeInTheDocument();
});

test("opens the request named by the integrations recovery link", async () => {
  const data = getDispatchDesignMockData();
  const target = data.requests[1];
  getTestSyncedDispatchDashboardDataMock.mockResolvedValueOnce(data);

  render(
    await CommandCentrePage({
      searchParams: Promise.resolve({ requestId: target.id }),
    }),
  );

  expect(
    within(screen.getByTestId("command-centre-drawer")).getByText(
      target.requestNumber,
    ),
  ).toBeInTheDocument();
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
  expect(screen.getByRole("dialog")).toHaveClass("max-w-3xl");
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

test("queue-opened work logs never silently select the first booking", () => {
  const data = getDispatchDesignMockData();
  const requestId = data.appointments.find((appointment) => appointment.requestId)?.requestId;
  expect(requestId).toBeTruthy();
  const requestAppointments = data.appointments.filter(
    (appointment) => appointment.requestId === requestId,
  );

  expect(resolveWorkLogAppointment(requestAppointments, undefined)).toBeUndefined();
  expect(
    resolveWorkLogAppointment(requestAppointments, requestAppointments[0]?.id),
  ).toEqual(requestAppointments[0]);
});

test("queue-opened request requires an explicit booking for Work Log", () => {
  const data = getDispatchDesignMockData();
  const request = data.requests[0];
  const first = {
    ...data.appointments[0],
    id: "booking-choice-first",
    requestId: request.id,
    start: "10:00",
    end: "10:30",
  };
  const second = {
    ...data.appointments[0],
    id: "booking-choice-second",
    requestId: request.id,
    technicianId: data.technicians[1].id,
    start: "11:00",
    end: "12:00",
  };

  render(
    <CommandCentrePrototype
      data={{ ...data, appointments: [...data.appointments, first, second] }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Assigned jobs" }));

  fireEvent.click(
    within(screen.getByTestId("request-queue")).getByRole("button", {
      name: `Open ${request.requestNumber} ticket workspace`,
    }),
  );
  const workspace = screen.getByRole("dialog", { name: "Ticket workspace" });
  const workLogButton = within(workspace).getByRole("button", { name: "Work Log" });
  expect(workLogButton).toBeDisabled();

  fireEvent.change(within(workspace).getByLabelText("Booking for Work Log"), {
    target: { value: second.id },
  });
  expect(workLogButton).toBeEnabled();
  fireEvent.click(workLogButton);

  expect(within(workspace).getByRole("region", { name: "Work Log" })).toBeInTheDocument();
  expect(within(workspace).getByText("11:00-12:00")).toBeInTheDocument();
});

test("live scheduling supports a lead technician and additional crew", () => {
  const data = getDispatchDesignMockData();
  const onCrewChange = vi.fn();

  render(
    <ScheduleConfirmModal
      liveSchedule
      pending={{
        bookingType: "Remote",
        crewTechnicianIds: [data.technicians[1].id],
        date: "2026-08-04",
        durationMinutes: 60,
        end: "11:00",
        kind: "request",
        requestId: data.requests[0].id,
        start: "10:00",
        technicianId: data.technicians[0].id,
        warnings: [],
      }}
      request={data.requests[0]}
      technicians={data.technicians}
      onBookingTypeChange={vi.fn()}
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
      onCrewChange={onCrewChange}
      onDurationChange={vi.fn()}
      onStartChange={vi.fn()}
      onTechnicianChange={vi.fn()}
    />,
  );

  expect(screen.getByLabelText("Lead technician")).toHaveValue(
    data.technicians[0].id,
  );
  expect(
    screen.getByRole("checkbox", { name: data.technicians[1].displayName }),
  ).toBeChecked();

  fireEvent.click(
    screen.getByRole("checkbox", { name: data.technicians[2].displayName }),
  );
  expect(onCrewChange).toHaveBeenCalledWith(data.technicians[2].id, true);
});

test("shows immediate proof that schedule confirmation was accepted", () => {
  const data = getDispatchDesignMockData();
  const onConfirm = vi.fn(() => new Promise<void>(() => undefined));

  render(
    <ScheduleConfirmModal
      liveSchedule
      pending={{
        bookingType: "Remote",
        date: "2026-08-04",
        durationMinutes: 15,
        end: "10:15",
        kind: "request",
        requestId: data.requests[0].id,
        start: "10:00",
        technicianId: data.technicians[0].id,
        warnings: [],
      }}
      request={data.requests[0]}
      technicians={data.technicians}
      onBookingTypeChange={vi.fn()}
      onCancel={vi.fn()}
      onConfirm={onConfirm}
      onDurationChange={vi.fn()}
      onStartChange={vi.fn()}
      onTechnicianChange={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Confirm schedule" }));

  expect(onConfirm).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Scheduling..." }))
    .toBeDisabled();
  expect(screen.getByRole("button", { name: "Scheduling..." }))
    .toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Saving booking and starting background sync",
  );
  fireEvent.click(screen.getByRole("button", { name: "Scheduling..." }));
  expect(onConfirm).toHaveBeenCalledOnce();
});

test("live schedule publishing times out instead of leaving the modal spinning", async () => {
  const fetchMock = vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  let outcome: string | undefined;

  void publishLiveSchedule({
    appointmentId: "pending-live-timeout",
    customer: "Example Co",
    date: "2026-08-04",
    end: "11:00",
    idempotencyKey: "schedule-timeout-test",
    location: "137 Main Street, Bairnsdale VIC 3875",
    requestId: "request-timeout",
    requestNumber: "REQ-TIMEOUT",
    start: "10:00",
    subject: "Timeout test",
    technicianId: "tech-jervy",
    technicianName: "Jervy",
    userPrincipalName: "jervy@egit.com.au",
  }).then(
    () => {
      outcome = "resolved";
    },
    (error: unknown) => {
      outcome = error instanceof Error ? error.message : "rejected";
    },
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_001);
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/internal/dispatch/live-schedule",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(outcome).toMatch(/timed out/i);
});

test("shows clear pending feedback while creating a request", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes("/api/internal/msp-central/lookups")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              customers: [
                {
                  address: "1 Rovan Place, Bairnsdale VIC 3875",
                  id: "customer-1",
                  name: "Bairnsdale Bearings",
                },
              ],
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          ),
        );
      }
      if (init?.method === "POST") return new Promise(() => undefined);
      return Promise.resolve(new Response("{}", { status: 200 }));
    }),
  );
  render(
    <CreateRequestModal
      onCancel={vi.fn()}
      onCreated={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText("Subject"), {
    target: { value: "Prepare a new laptop" },
  });
  fireEvent.change(screen.getByLabelText("Customer"), {
    target: { value: "Bairnsdale" },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(251);
  });
  fireEvent.click(screen.getByRole("button", {
    name: /Bairnsdale Bearings/i,
  }));
  fireEvent.click(screen.getByRole("button", { name: "Create request" }));

  const button = screen.getByRole("button", { name: "Creating request..." });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
});

test("loads customer contacts and autofills requester email for a new request", async () => {
  const fetchMock = vi.fn((url: string) => {
    const textUrl = String(url);
    if (textUrl.includes("type=customers")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            customers: [
              {
                address: "1 Rovan Place, Bairnsdale VIC 3875",
                id: "customer-1",
                name: "Bairnsdale Bearings",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    }
    if (textUrl.includes("type=contacts")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            contacts: [
              {
                email: "mireille@example.com",
                id: "contact-1",
                name: "Mireille",
                phone: "0351432432",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<CreateRequestModal onCancel={vi.fn()} onCreated={vi.fn()} />);

  fireEvent.change(screen.getByLabelText("Customer"), {
    target: { value: "Bairnsdale" },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(251);
  });
  fireEvent.click(screen.getByRole("button", { name: /Bairnsdale Bearings/i }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(251);
  });

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("type=contacts"),
    expect.any(Object),
  );
  expect(screen.getByLabelText("Requester")).toHaveValue("Mireille");
  expect(screen.getByLabelText("Requester email")).toHaveValue(
    "mireille@example.com",
  );
  expect(screen.getByLabelText("Site")).toHaveValue(
    "1 Rovan Place, Bairnsdale VIC 3875",
  );
});

test("offers to create a customer when customer search has no matches", async () => {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const textUrl = String(url);
    if (textUrl.includes("type=customers")) {
      return Promise.resolve(
        new Response(JSON.stringify({ customers: [] }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      );
    }
    if (init?.method === "POST") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            customer: {
              address: "10 Main Street, Bairnsdale, VIC, 3875",
              city: "Bairnsdale",
              customerGroup: "Sale",
              id: "customer-new-1",
              name: "Wildlife Rescue",
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 201 },
        ),
      );
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<CreateRequestModal onCancel={vi.fn()} onCreated={vi.fn()} />);

  fireEvent.change(screen.getByLabelText("Customer"), {
    target: { value: "Wildlife Rescue" },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(251);
  });
  fireEvent.click(
    screen.getByRole("button", { name: 'Create customer "Wildlife Rescue"' }),
  );

  const customerDialog = screen.getByRole("dialog", { name: "Create customer" });
  fireEvent.change(within(customerDialog).getByLabelText("Address"), {
    target: { value: "10 Main Street" },
  });
  fireEvent.change(within(customerDialog).getByLabelText("City"), {
    target: { value: "Bairnsdale" },
  });
  fireEvent.change(within(customerDialog).getByLabelText("Customer group"), {
    target: { value: "Sale" },
  });
  fireEvent.change(within(customerDialog).getByLabelText("State"), {
    target: { value: "VIC" },
  });
  fireEvent.change(within(customerDialog).getByLabelText("Postcode"), {
    target: { value: "3875" },
  });
  await act(async () => {
    fireEvent.click(
      within(customerDialog).getByRole("button", { name: "Create customer" }),
    );
    await Promise.resolve();
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/internal/msp-central/lookups",
    expect.objectContaining({ method: "POST" }),
  );
  const createCall = fetchMock.mock.calls.find(
    ([url, init]) =>
      url === "/api/internal/msp-central/lookups" && init?.method === "POST",
  );
  expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
    address: "10 Main Street",
    city: "Bairnsdale",
    customerGroup: "Sale",
    name: "Wildlife Rescue",
    postalCode: "3875",
    state: "VIC",
    type: "customer",
  });
  expect(screen.getByLabelText("Customer")).toHaveValue("Wildlife Rescue");
  expect(screen.getByLabelText("Site")).toHaveValue(
    "10 Main Street, Bairnsdale, VIC, 3875",
  );
});

test("submits Helpdesk request classification fields from the create request form", async () => {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const textUrl = String(url);
    if (textUrl.includes("type=request-options")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            options: {
              categories: ["Hardware", "Network"],
              impacts: ["Affects Business", "Affects User"],
              priorities: ["Low", "Medium", "High", "Critical"],
              requestTypes: ["Incident", "Service Request"],
              subcategories: ["Printer", "Switching"],
              urgencies: ["Low", "Normal", "High", "Urgent"],
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    }
    if (textUrl.includes("type=customers")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            customers: [
              {
                id: "customer-1",
                name: "Example Co",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    }
    if (textUrl.includes("type=contacts")) {
      return Promise.resolve(
        new Response(JSON.stringify({ contacts: [] }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      );
    }
    if (init?.method === "POST") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            operationId: "operation-create-1",
            pendingRequestId: "pending:create-1",
            status: "queued",
          }),
          { headers: { "Content-Type": "application/json" }, status: 202 },
        ),
      );
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<CreateRequestModal onCancel={vi.fn()} onCreated={vi.fn()} />);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  fireEvent.change(screen.getByLabelText("Subject"), {
    target: { value: "Printer offline" },
  });
  fireEvent.change(screen.getByLabelText("Customer"), {
    target: { value: "Example" },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(251);
  });
  fireEvent.click(screen.getByRole("button", { name: /Example Co/i }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(251);
  });
  fireEvent.change(screen.getByLabelText("Request type"), {
    target: { value: "Incident" },
  });
  fireEvent.change(screen.getByLabelText("Impact"), {
    target: { value: "Affects User" },
  });
  fireEvent.change(screen.getByLabelText("Urgency"), {
    target: { value: "High" },
  });
  fireEvent.change(screen.getByLabelText("Priority"), {
    target: { value: "High" },
  });
  fireEvent.change(screen.getByLabelText("Category"), {
    target: { value: "Hardware" },
  });
  fireEvent.change(screen.getByLabelText("Subcategory"), {
    target: { value: "Printer" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create request" }));
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/internal/msp-central/requests",
    expect.objectContaining({ method: "POST" }),
  );
  const createCall = fetchMock.mock.calls.find(
    ([url]) => url === "/api/internal/msp-central/requests",
  );
  expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
    category: "Hardware",
    impact: "Affects User",
    priority: "High",
    requestType: "Incident",
    subcategory: "Printer",
    urgency: "High",
  });
  expect(JSON.parse(String(createCall?.[1]?.body))).not.toMatchObject({
    group: expect.anything(),
    item: expect.anything(),
    level: expect.anything(),
    mode: expect.anything(),
  });
});

test("keeps the create request form focused on fields dispatch actually uses", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ options: {} }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      ),
    ),
  );

  render(<CreateRequestModal onCancel={vi.fn()} onCreated={vi.fn()} />);

  expect(screen.getByLabelText("Requester")).toBeInTheDocument();
  expect(screen.getByLabelText("Request type")).toBeInTheDocument();
  expect(screen.getByLabelText("Status")).toBeInTheDocument();
  expect(screen.getByLabelText("Impact")).toBeInTheDocument();
  expect(screen.getByLabelText("Urgency")).toBeInTheDocument();
  expect(screen.getByLabelText("Priority")).toBeInTheDocument();
  expect(screen.getByLabelText("Category")).toBeInTheDocument();
  expect(screen.getByLabelText("Subcategory")).toBeInTheDocument();
  expect(screen.queryByLabelText("Mode")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Level")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Group")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Item")).not.toBeInTheDocument();
});

test("shows clear pending feedback while merging a request", () => {
  const data = getDispatchDesignMockData();
  render(
    <MergeRequestModal
      childRequest={data.requests[0]}
      requests={data.requests}
      onCancel={vi.fn()}
      onConfirm={vi.fn(() => new Promise(() => undefined))}
    />,
  );

  fireEvent.change(screen.getByPlaceholderText("Search request number, subject or customer"), {
    target: { value: data.requests[1].requestNumber },
  });
  fireEvent.click(screen.getByRole("button", {
    name: `Select ${data.requests[1].requestNumber} as surviving parent`,
  }));
  fireEvent.click(screen.getByRole("button", { name: "Review merge" }));
  fireEvent.click(screen.getByRole("button", { name: "Merge duplicate into parent" }));

  const button = screen.getByRole("button", { name: "Merging requests..." });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
});

test("shows clear pending feedback while saving a Work Log", () => {
  const data = getDispatchDesignMockData();
  const request = { ...data.requests[0], scheduledStart: undefined, scheduledEnd: undefined };
  render(
    <WorkLogModal
      liveWriteback={false}
      request={request}
      technician="Simeon"
      technicians={data.technicians}
      onCancel={vi.fn()}
      onSave={vi.fn(() => new Promise(() => undefined))}
    />,
  );

  fireEvent.change(screen.getByLabelText("Work Log notes"), {
    target: { value: "Prepared and tested the device." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save Work Log" }));

  const button = screen.getByRole("button", { name: "Saving Work Log..." });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
});

test("shows clear pending feedback while sending a customer communication", () => {
  const data = getDispatchDesignMockData();
  const request = { ...data.requests[0], sourceSystem: "msp-central" as const };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Promise(() => undefined);
      return Promise.resolve(new Response(JSON.stringify({
        customerResponses: [],
        internalNotes: [],
        request,
        worklogs: [],
      }), { headers: { "Content-Type": "application/json" }, status: 200 }));
    }),
  );
  render(
    <TicketWorkspaceModal
      appointments={[]}
      liveWriteback
      request={request}
      onClose={vi.fn()}
      onOpenWorkLog={vi.fn()}
      onSaved={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("tab", { name: "Comms" }));
  fireEvent.change(screen.getByLabelText("Communication message"), {
    target: { value: "Your device is ready for collection." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send to customer" }));

  const button = screen.getByRole("button", { name: "Sending..." });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
});

test("does not overlap ticket context refreshes while a read is still pending", async () => {
  const data = getDispatchDesignMockData();
  const request = { ...data.requests[0], sourceSystem: "msp-central" as const };
  const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <TicketWorkspaceModal
      appointments={[]}
      liveWriteback
      request={request}
      onClose={vi.fn()}
      onOpenWorkLog={vi.fn()}
      onSaved={vi.fn()}
    />,
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("stops refreshing and keeps local ticket data visible when context loading times out", async () => {
  const data = getDispatchDesignMockData();
  const request = {
    ...data.requests[0],
    notes: "Cached request description remains available.",
    sourceSystem: "msp-central" as const,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }),
    ),
  );

  render(
    <TicketWorkspaceModal
      appointments={[]}
      liveWriteback
      request={request}
      onClose={vi.fn()}
      onOpenWorkLog={vi.fn()}
      onSaved={vi.fn()}
    />,
  );

  expect(screen.getByText("Refreshing ticket...")).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });

  expect(screen.queryByText("Refreshing ticket...")).not.toBeInTheDocument();
  expect(screen.getByText(/Ticket refresh timed out/i)).toBeInTheDocument();
  expect(screen.getByText(request.notes)).toBeInTheDocument();
});

test("shows clear pending feedback while applying a Track", async () => {
  vi.useRealTimers();
  const data = getDispatchDesignMockData();
  const request = {
    ...data.requests[0],
    notes: "",
    sourceSystem: "msp-central" as const,
    subject: "General computer issue",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Promise(() => undefined);
      if (url.includes("/workflow")) {
        return Promise.resolve(new Response(JSON.stringify({ workflow: null }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        customerResponses: [],
        internalNotes: [],
        request,
        worklogs: [],
      }), { headers: { "Content-Type": "application/json" }, status: 200 }));
    }),
  );
  render(
    <TicketWorkspaceModal
      appointments={[]}
      liveWriteback
      request={request}
      onClose={vi.fn()}
      onOpenWorkLog={vi.fn()}
      onSaved={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("tab", { name: "Tracks" }));
  const applyButton = await screen.findByRole("button", { name: "Apply ticket template" });
  fireEvent.click(applyButton);

  const button = screen.getByRole("button", { name: "Saving Track..." });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
});

test("reuses the same optimistic appointment id when a schedule command is retried", () => {
  expect(pendingLiveAppointmentId("request-123", "schedule:command-123")).toBe(
    pendingLiveAppointmentId("request-123", "schedule:command-123"),
  );
  expect(pendingLiveAppointmentId("request-123", "schedule:command-123")).not.toBe(
    pendingLiveAppointmentId("request-123", "schedule:command-456"),
  );
});

test("classifies provider write receipts without claiming false success", () => {
  expect(integrationReceiptDisposition("queued")).toEqual({
    closeForm: true,
    phase: "pending",
  });
  expect(integrationReceiptDisposition("syncing")).toEqual({
    closeForm: true,
    phase: "pending",
  });
  expect(integrationReceiptDisposition("retrying")).toEqual({
    closeForm: true,
    phase: "retrying",
  });
  expect(integrationReceiptDisposition("review_required")).toEqual({
    closeForm: true,
    phase: "review_required",
  });
  expect(integrationReceiptDisposition("synced")).toEqual({
    closeForm: true,
    phase: "synced",
  });
});

test("closes schedule confirmation and leaves persistent review state", async () => {
  const data = getDispatchDesignMockData();
  const request = data.requests[0];
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({
      operationId: "operation-schedule-review",
      status: "review_required",
    }),
    ok: true,
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <CommandCentrePrototype
      showIntegrations
      data={{
        ...data,
        calendarDataSource: "outlook",
        calendarReadOnly: false,
        dispatchDataSource: "msp-central",
        requests: data.requests.map((candidate) =>
          candidate.id === request.id
            ? { ...candidate, sourceSystem: "msp-central" as const }
            : candidate,
        ),
      }}
    />,
  );

  const requestButton = screen.getByRole("button", {
    name: `${request.requestNumber} ${request.subject}`,
  });
  const requestCard = requestButton.closest("article");
  if (!requestCard) throw new Error("Expected draggable request card.");
  const dataTransfer = {
    effectAllowed: "move",
    setData: vi.fn(),
  };
  fireEvent.dragStart(requestCard, { dataTransfer });
  await act(async () => undefined);
  fireEvent.drop(screen.getAllByTestId("timeline-track")[0], {
    clientX: 120,
    dataTransfer,
  });

  await act(async () => undefined);
  const dialog = screen.getByText("Schedule request").closest("section");
  if (!dialog) throw new Error("Expected schedule confirmation dialog.");
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm schedule" }));
  await act(async () => undefined);

  expect(screen.queryByText("Schedule request")).not.toBeInTheDocument();
  await act(async () => undefined);
  expect(screen.getByRole("link", { name: "Review required" })).toHaveAttribute(
    "href",
    "/integrations",
  );
});

test("accepts a live schedule locally even when provider queue confirmation stalls", async () => {
  const data = getDispatchDesignMockData();
  const request = data.requests[0];
  const fetchMock = vi.fn(
    () => new Promise<Response>(() => undefined),
  );
  vi.stubGlobal("fetch", fetchMock);

  render(
    <CommandCentrePrototype
      data={{
        ...data,
        appointments: [],
        calendarDataSource: "outlook",
        calendarReadOnly: false,
        dispatchDataSource: "msp-central",
        requests: data.requests.map((candidate) =>
          candidate.id === request.id
            ? { ...candidate, sourceSystem: "msp-central" as const }
            : candidate,
        ),
      }}
    />,
  );

  const requestButton = screen.getByRole("button", {
    name: `${request.requestNumber} ${request.subject}`,
  });
  const requestCard = requestButton.closest("article");
  if (!requestCard) throw new Error("Expected draggable request card.");
  const dataTransfer = { effectAllowed: "move", setData: vi.fn() };
  fireEvent.dragStart(requestCard, { dataTransfer });
  await act(async () => undefined);
  fireEvent.drop(screen.getAllByTestId("timeline-track")[0], {
    clientX: 120,
    dataTransfer,
  });

  await act(async () => undefined);
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm schedule" }));
  await act(async () => undefined);

  expect(fetchMock).toHaveBeenCalledOnce();
  expect(screen.queryByText("Schedule request")).not.toBeInTheDocument();
  expect(
    screen.getByText(
      `${request.requestNumber} saved in Command Centre. Syncing with MSP Central and Outlook.`,
    ),
  ).toBeInTheDocument();
  expect(screen.getAllByText(request.subject).length).toBeGreaterThan(0);
});

test("rescheduling a refreshed crew appointment sends the parent schedule group", async () => {
  const data = getDispatchDesignMockData();
  const request = {
    ...data.requests[0],
    sourceSystem: "msp-central" as const,
    status: "Scheduled" as const,
    technicianId: data.technicians[0].id,
  };
  const lead = {
    ...data.appointments[0],
    calendarOwnerEmail: data.technicians[0].outlookEmail,
    customer: request.customer,
    date: "2026-07-08",
    end: "11:00",
    id: "parent-link-1",
    outlookEventId: "event-lead",
    readOnly: false,
    requestId: request.id,
    scheduleAssignmentRole: "lead" as const,
    scheduleGroupId: "parent-link-1",
    start: "10:00",
    technicianId: data.technicians[0].id,
    title: request.subject,
  };
  const crew = {
    ...lead,
    calendarOwnerEmail: data.technicians[1].outlookEmail,
    id: "crew-row-uuid",
    outlookEventId: "event-crew",
    scheduleAssignmentRole: "crew" as const,
    technicianId: data.technicians[1].id,
  };
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({
      operationId: "operation-reschedule-1",
      status: "queued",
    }),
    ok: true,
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <CommandCentrePrototype
      data={{
        ...data,
        appointments: [lead, crew],
        calendarDataSource: "outlook",
        calendarReadOnly: false,
        dispatchDataSource: "msp-central",
        requests: [request],
        selectedRequestId: request.id,
      }}
    />,
  );

  fireEvent.click(screen.getByTestId("timeline-appointment-crew-row-uuid"));
  fireEvent.click(
    within(screen.getByTestId("command-centre-drawer")).getByRole("button", {
      name: "Reschedule",
    }),
  );
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Booking date"), {
    target: { value: "2026-07-09" },
  });
  await act(async () => {
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm schedule" }),
    );
  });

  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/internal/dispatch/live-schedule");
  expect(JSON.parse(String(init.body))).toMatchObject({
    appointmentId: "parent-link-1",
    date: "2026-07-09",
    previousAssignments: expect.arrayContaining([
      expect.objectContaining({ eventId: "event-lead" }),
      expect.objectContaining({ eventId: "event-crew" }),
    ]),
  });
  expect(screen.getByText("Thursday 9 July 2026")).toBeInTheDocument();
});

test("dragging a scheduled appointment reschedules the existing booking group", async () => {
  const data = getDispatchDesignMockData();
  const request = {
    ...data.requests[0],
    scheduledEnd: "2026-07-08T11:00:00+10:00",
    scheduledStart: "2026-07-08T10:00:00+10:00",
    sourceSystem: "msp-central" as const,
    status: "Scheduled" as const,
    technicianId: data.technicians[0].id,
  };
  const lead = {
    ...data.appointments[0],
    calendarOwnerEmail: data.technicians[0].outlookEmail,
    date: "2026-07-08",
    end: "11:00",
    id: "drag-existing-lead",
    outlookEventId: "event-existing-lead",
    readOnly: false,
    requestId: request.id,
    scheduleAssignmentRole: "lead" as const,
    scheduleGroupId: "existing-schedule-group",
    start: "10:00",
    technicianId: data.technicians[0].id,
    title: request.subject,
  };
  const targetTechnician = data.technicians[1];
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({
      appointmentId: "existing-schedule-group",
      operationId: "operation-drag-reschedule-1",
      status: "queued",
    }),
    ok: true,
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <CommandCentrePrototype
      data={{
        ...data,
        appointments: [lead],
        calendarDataSource: "outlook",
        calendarReadOnly: false,
        dispatchDataSource: "msp-central",
        requests: [request],
        selectedRequestId: request.id,
      }}
    />,
  );

  const appointmentCard = screen.getByTestId("timeline-appointment-drag-existing-lead");
  const dataTransfer = { effectAllowed: "move", setData: vi.fn() };
  fireEvent.dragStart(appointmentCard, { dataTransfer });
  await act(async () => undefined);
  fireEvent.drop(
    screen.getAllByTestId("timeline-track")[
      data.technicians.findIndex((technician) => technician.id === targetTechnician.id)
    ],
    { clientX: 120, dataTransfer },
  );
  await act(async () => undefined);
  const dialog = screen.getByRole("dialog");
  await act(async () => {
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm schedule" }),
    );
  });

  expect(fetchMock).toHaveBeenCalledOnce();
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(JSON.parse(String(init.body))).toMatchObject({
    appointmentId: "existing-schedule-group",
    previousAssignments: [
      {
        eventId: "event-existing-lead",
        technicianId: data.technicians[0].id,
        userPrincipalName: data.technicians[0].outlookEmail,
      },
    ],
    scheduleAction: "rescheduled",
    technicianId: targetTechnician.id,
  });
  expect(screen.getAllByTestId(/timeline-appointment-/)).toHaveLength(1);
});

test("queue scheduling reassigns an existing linked booking instead of duplicating it", async () => {
  const data = getDispatchDesignMockData();
  const request = {
    ...data.requests[0],
    sourceSystem: "msp-central" as const,
  };
  const simeon = data.technicians.find(
    (technician) => technician.displayName === "Simeon",
  )!;
  const jervy = data.technicians.find(
    (technician) => technician.displayName === "Jervy",
  )!;
  const existing = {
    ...data.appointments[0],
    calendarOwnerEmail: simeon.outlookUserPrincipalName ?? simeon.outlookEmail,
    date: "2026-07-08",
    end: "11:00",
    id: "existing-simeon-booking",
    outlookEventId: "outlook-simeon-event",
    requestId: request.id,
    scheduleAssignmentRole: "lead" as const,
    scheduleGroupId: "existing-schedule-group",
    start: "10:00",
    technicianId: simeon.id,
    title: request.subject,
  };
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({
      appointmentId: "existing-schedule-group",
      operationId: "operation-reassign-1",
      status: "queued",
    }),
    ok: true,
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <CommandCentrePrototype
      data={{
        ...data,
        appointments: [existing],
        calendarDataSource: "outlook",
        calendarReadOnly: false,
        dispatchDataSource: "msp-central",
        requests: [request],
        selectedRequestId: request.id,
      }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Assigned jobs" }));

  const requestCard = screen
    .getByRole("button", { name: `${request.requestNumber} ${request.subject}` })
    .closest("article");
  if (!requestCard) throw new Error("Expected draggable request card.");
  const dataTransfer = { effectAllowed: "move", setData: vi.fn() };
  fireEvent.dragStart(requestCard, { dataTransfer });
  await act(async () => undefined);
  fireEvent.drop(
    screen.getAllByTestId("timeline-track")[
      data.technicians.findIndex((technician) => technician.id === jervy.id)
    ],
    { clientX: 120, dataTransfer },
  );
  await act(async () => undefined);
  const dialog = screen.getByRole("dialog");
  await act(async () => {
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm schedule" }),
    );
  });

  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(JSON.parse(String(init.body))).toMatchObject({
    appointmentId: "existing-schedule-group",
    previousAssignments: [
      {
        eventId: "outlook-simeon-event",
        technicianId: simeon.id,
        userPrincipalName: simeon.outlookUserPrincipalName ?? simeon.outlookEmail,
      },
    ],
    technicianId: jervy.id,
  });
  expect(
    screen.queryByTestId("timeline-appointment-existing-simeon-booking"),
  ).not.toBeInTheDocument();
});

test("dragging a scheduled request reuses an Outlook booking linked by ticket number", async () => {
  const data = getDispatchDesignMockData();
  const request = {
    ...data.requests[0],
    id: "676800000237190",
    requestNumber: "237190",
    sourceSystem: "msp-central" as const,
  };
  const simeon = data.technicians.find(
    (technician) => technician.displayName === "Simeon",
  )!;
  const jervy = data.technicians.find(
    (technician) => technician.displayName === "Jervy",
  )!;
  const existing = {
    ...data.appointments[0],
    calendarOwnerEmail: simeon.outlookUserPrincipalName ?? simeon.outlookEmail,
    date: "2026-07-08",
    end: "11:00",
    id: "outlook-number-linked-booking",
    outlookEventId: "outlook-number-linked-event",
    outlookLinkedRequestNumber: "237190",
    requestId: "237190",
    scheduleAssignmentRole: "lead" as const,
    scheduleGroupId: "number-linked-schedule-group",
    start: "10:00",
    technicianId: simeon.id,
    title: request.subject,
  };
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({
      appointmentId: "number-linked-schedule-group",
      operationId: "operation-number-linked-reschedule",
      status: "queued",
    }),
    ok: true,
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <CommandCentrePrototype
      data={{
        ...data,
        appointments: [existing],
        calendarDataSource: "outlook",
        calendarReadOnly: false,
        dispatchDataSource: "msp-central",
        requests: [request],
        selectedRequestId: request.id,
      }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Assigned jobs" }));
  const requestCard = screen
    .getByRole("button", { name: `${request.requestNumber} ${request.subject}` })
    .closest("article");
  if (!requestCard) throw new Error("Expected draggable request card.");
  const dataTransfer = { effectAllowed: "move", setData: vi.fn() };
  fireEvent.dragStart(requestCard, { dataTransfer });
  await act(async () => undefined);
  fireEvent.drop(
    screen.getAllByTestId("timeline-track")[
      data.technicians.findIndex((technician) => technician.id === jervy.id)
    ],
    { clientX: 120, dataTransfer },
  );
  await act(async () => undefined);
  const dialog = screen.getByRole("dialog");
  await act(async () => {
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm schedule" }),
    );
  });

  expect(fetchMock).toHaveBeenCalledOnce();
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(JSON.parse(String(init.body))).toMatchObject({
    appointmentId: "number-linked-schedule-group",
    previousAssignments: [
      {
        eventId: "outlook-number-linked-event",
        technicianId: simeon.id,
        userPrincipalName: simeon.outlookUserPrincipalName ?? simeon.outlookEmail,
      },
    ],
    scheduleAction: "rescheduled",
    technicianId: jervy.id,
  });
});

test("does not claim manual calendar sync succeeded when review is required", async () => {
  const data = getDispatchDesignMockData();
  const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        operationId: "operation-calendar-review",
        status: "review_required",
      }),
      ok: true,
    });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <CommandCentrePrototype
      data={{
        ...data,
        calendarDataSource: "outlook",
        calendarReadOnly: false,
        dispatchDataSource: "msp-central",
        requests: data.requests.map((request) => ({
          ...request,
          sourceSystem: "msp-central" as const,
        })),
      }}
    />,
  );

  fireEvent.click(screen.getByTestId("timeline-appointment-appt-1"));
  const drawer = screen.getByTestId("command-centre-drawer");
  const syncButton = within(drawer).getByRole("button", {
    name: "Create / Update Calendar Event",
  });
  expect(syncButton).toBeEnabled();
  fireEvent.click(syncButton);
  await act(async () => undefined);
  expect(fetchMock).toHaveBeenCalled();

  expect(
    screen.getByText("REQ-100211 calendar sync needs review."),
  ).toBeInTheDocument();
  expect(screen.queryByText("REQ-100211 synced to MSP Central and Outlook.")).not.toBeInTheDocument();
});

test("keeps error notices visible longer than success notices", () => {
  expect(
    toastAutoDismissMs(
      "REQ-100284 scheduled. Syncing with MSP Central and Outlook.",
    ),
  ).toBe(3_500);
  expect(
    toastAutoDismissMs("Live schedule did not save: MSP Central unavailable."),
  ).toBe(8_000);
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
    "Outlook-only bookings cannot be rescheduled from Command Centre.",
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

test("keeps the Helpdesk link available for a completed request calendar booking", async () => {
  const data = getDispatchDesignMockData();
  getTestSyncedDispatchDashboardDataMock.mockResolvedValue({
    ...data,
    appointments: [
      {
        customer: "East Gippsland IT",
        date: "2026-07-08",
        end: "12:45",
        helpdeskUrl: "https://mspcentral.example/requests/6768000001414219",
        id: "completed-request-booking",
        outlookLinkedRequestNumber: "6768000001414219",
        requestId: "6768000001414219",
        source: "outlook",
        start: "11:30",
        status: "busy",
        technicianId: "tech-simeon",
        title: "test",
      },
    ],
    requests: [],
    selectedRequestId: "",
  });

  render(await CommandCentrePage());
  fireEvent.click(screen.getByRole("button", { name: /test East Gippsland IT/ }));

  expect(
    within(screen.getByTestId("command-centre-drawer")).getByRole("link", {
      name: "Open in Helpdesk",
    }),
  ).toHaveAttribute(
    "href",
    "https://mspcentral.example/requests/6768000001414219",
  );
});

test("folds Work Log into the ticket workspace from the drawer", async () => {
  render(await CommandCentrePage());

  const drawer = screen.getByTestId("command-centre-drawer");
  expect(
    within(drawer).queryByRole("button", { name: "Work Log" }),
  ).not.toBeInTheDocument();
  fireEvent.click(within(drawer).getByRole("button", { name: "Comms" }));

  const dialog = screen.getByRole("dialog", { name: "Ticket workspace" });
  fireEvent.click(within(dialog).getByRole("tab", { name: "Work Log" }));
  expect(within(dialog).getByRole("region", { name: "Ticket information" })).toBeInTheDocument();
  expect(within(dialog).getByRole("region", { name: "Work Log entry" })).toBeInTheDocument();
  expect(within(dialog).getByRole("heading", { name: "Work Log" })).toBeInTheDocument();
  expect(within(dialog).getByText("Latest job information")).toBeInTheDocument();
  expect(within(dialog).getByText("Request number")).toBeInTheDocument();
  expect(within(dialog).getAllByText("REQ-100284").length).toBeGreaterThan(0);
  expect(
    within(dialog).getAllByText("Packhouse label printer offline").length,
  ).toBeGreaterThan(0);
  expect(within(dialog).getByText("Customer/site")).toBeInTheDocument();
  expect(within(dialog).getByText("Status")).toBeInTheDocument();
  expect(within(dialog).getByText("Priority")).toBeInTheDocument();
  expect(within(dialog).getByText("Technician")).toBeInTheDocument();
  expect(within(dialog).getByText("Scheduled time")).toBeInTheDocument();
  expect(within(dialog).getByText("Due time")).toBeInTheDocument();
  expect(within(dialog).getByText("Contact")).toBeInTheDocument();
  expect(within(dialog).getByText("Site/address")).toBeInTheDocument();
  expect(within(dialog).getByText("Job description")).toBeInTheDocument();
  expect(within(dialog).queryByText("Visibility")).not.toBeInTheDocument();
  expect(within(dialog).queryByLabelText("Customer-facing")).not.toBeInTheDocument();
  expect(within(dialog).queryByLabelText("Internal")).not.toBeInTheDocument();
  expect(within(dialog).getByLabelText("Work Log notes")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Time spent")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Work type")).toBeInTheDocument();
  expect(within(dialog).queryByRole("checkbox", { name: "Billable" })).not.toBeInTheDocument();
  expect(within(dialog).queryByText("Outcome")).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Save Work Log" })).toBeInTheDocument();
});

test("shows a Work Log attachments button when the request has attachments", () => {
  const data = getDispatchDesignMockData();
  const request = {
    ...data.requests[0],
    attachments: [
      {
        id: "attachment-1",
        fileName: "switch-photo.jpg",
        url: "https://mspcentral.example/requests/123/attachments/attachment-1",
      },
      {
        id: "attachment-2",
        fileName: "quote.pdf",
      },
    ],
    helpdeskUrl: "https://mspcentral.example/requests/123",
  } as DispatchRequest;

  render(
    <WorkLogModal
      liveWriteback
      request={request}
      technician="Jervy"
      technicians={data.technicians}
      onCancel={vi.fn()}
      onSave={vi.fn()}
    />,
  );

  const dialog = screen.getByRole("dialog", { name: "Work Log" });
  expect(
    within(dialog).getByRole("link", { name: "Open attachments 2" }),
  ).toHaveAttribute("href", "https://mspcentral.example/requests/123");
  expect(within(dialog).getByText("switch-photo.jpg")).toBeInTheDocument();
  expect(within(dialog).getByText("quote.pdf")).toBeInTheDocument();
});

test("hides the Work Log attachments button when the request has no attachments", () => {
  const data = getDispatchDesignMockData();

  render(
    <WorkLogModal
      liveWriteback
      request={{ ...data.requests[0], attachments: [] } as DispatchRequest}
      technician="Jervy"
      technicians={data.technicians}
      onCancel={vi.fn()}
      onSave={vi.fn()}
    />,
  );

  const dialog = screen.getByRole("dialog", { name: "Work Log" });
  expect(
    within(dialog).queryByRole("link", { name: /Open attachments/ }),
  ).not.toBeInTheDocument();
});

test("keeps customer communication out of the Work Log flow", async () => {
  render(await CommandCentrePage());

  const dialog = openSelectedDrawerWorkLogTab();
  expect(within(dialog).getByLabelText("Work type")).toBeInTheDocument();
  expect(within(dialog).queryByText("Visibility")).not.toBeInTheDocument();
  expect(within(dialog).queryByText("Customer-facing")).not.toBeInTheDocument();
});

test("opens Work Log against the exact selected appointment", async () => {
  const data = getDispatchDesignMockData();
  const first = data.appointments.find((appointment) => appointment.id === "appt-1");
  if (!first?.requestId) throw new Error("Expected appt-1 fixture.");
  const second = {
    ...first,
    end: "15:00",
    id: "appt-1-second",
    start: "14:00",
    title: "Follow-up visit",
  };

  render(
    <CommandCentrePrototype
      data={{ ...data, appointments: [...data.appointments, second] }}
    />,
  );
  fireEvent.click(screen.getByTestId("timeline-appointment-appt-1-second"));

  const dialog = openSelectedDrawerWorkLogTab();
  expect(within(dialog).getByText("14:00-15:00")).toBeInTheDocument();
});

test("preserves optimistic schedules while refreshed server data is still stale", () => {
  const incoming = getDispatchDesignMockData();
  const request = incoming.requests[0];
  const optimisticRequest = {
    ...request,
    scheduledEnd: "2026-07-08T11:00:00.000Z",
    scheduledStart: "2026-07-08T10:00:00.000Z",
    status: "Scheduled" as const,
    technicianId: "tech-simeon",
  };
  const optimisticAppointment = {
    customer: request.customer,
    date: "2026-07-08",
    end: "11:00",
    id: "pending-live-refresh-test",
    requestId: request.id,
    source: "linked" as const,
    start: "10:00",
    status: "confirmed" as const,
    technicianId: "tech-simeon",
    title: request.subject,
  };
  const current = {
    ...incoming,
    appointments: [...incoming.appointments, optimisticAppointment],
    requests: incoming.requests.map((candidate) =>
      candidate.id === request.id ? optimisticRequest : candidate,
    ),
  };

  const reconciled = reconcileDashboardWithPendingWritebacks(
    current,
    incoming,
    new Set([request.id]),
  );

  expect(
    reconciled.appointments.find((appointment) => appointment.id === optimisticAppointment.id),
  ).toEqual(optimisticAppointment);
  expect(
    reconciled.requests.find((candidate) => candidate.id === request.id),
  ).toEqual(optimisticRequest);
});

test("preserves a dragged reschedule without keeping the stale old booking", () => {
  const incoming = getDispatchDesignMockData();
  const request = {
    ...incoming.requests[0],
    scheduledEnd: "2026-07-08T11:00:00.000Z",
    scheduledStart: "2026-07-08T10:00:00.000Z",
    status: "Scheduled" as const,
    technicianId: "tech-simeon",
  };
  const staleAppointment = {
    customer: request.customer,
    date: "2026-07-08",
    end: "11:00",
    id: "old-simeon-booking",
    requestId: request.id,
    scheduleGroupId: "schedule-group-1",
    source: "linked" as const,
    start: "10:00",
    status: "confirmed" as const,
    technicianId: "tech-simeon",
    title: request.subject,
  };
  const optimisticRequest = {
    ...request,
    scheduledEnd: "2026-07-08T12:00:00.000Z",
    scheduledStart: "2026-07-08T11:00:00.000Z",
    technicianId: "tech-jervy",
  };
  const movedAppointment = {
    ...staleAppointment,
    id: "moved-jervy-booking",
    end: "12:00",
    start: "11:00",
    technicianId: "tech-jervy",
  };

  const reconciled = reconcileDashboardWithPendingWritebacks(
    {
      ...incoming,
      appointments: [movedAppointment],
      requests: incoming.requests.map((candidate) =>
        candidate.id === request.id ? optimisticRequest : candidate,
      ),
    },
    {
      ...incoming,
      appointments: [staleAppointment],
      requests: incoming.requests.map((candidate) =>
        candidate.id === request.id ? request : candidate,
      ),
    },
    new Set([request.id]),
  );

  expect(reconciled.appointments).toHaveLength(1);
  expect(reconciled.appointments[0]).toMatchObject({
    id: "moved-jervy-booking",
    start: "11:00",
    technicianId: "tech-jervy",
  });
  expect(
    reconciled.appointments.some((appointment) => appointment.id === "old-simeon-booking"),
  ).toBe(false);
});

test("keeps customer communications separate from a live Work Log", async () => {
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
          contactEmail: "labels@example.com",
          contactPhone: "03 5152 4450",
          notes: "The Zebra label printer is offline after a power outage.",
          sourceSystem: "msp-central",
        },
      }),
      ok: true,
    })),
  );

  render(await CommandCentrePage());

  const dialog = openSelectedDrawerWorkLogTab();
  expect(await within(dialog).findByText("Job description")).toBeInTheDocument();
  expect(
    await within(dialog).findByText(
      "The Zebra label printer is offline after a power outage.",
    ),
  ).toBeInTheDocument();
  expect(within(dialog).getByText("Phone")).toBeInTheDocument();
  expect(within(dialog).getByText("03 5152 4450")).toBeInTheDocument();
  expect(within(dialog).getByText("Email")).toBeInTheDocument();
  expect(within(dialog).getByText("labels@example.com")).toBeInTheDocument();
  expect(within(dialog).queryByText("Customer responses")).not.toBeInTheDocument();
  expect(within(dialog).queryByText("Internal notes")).not.toBeInTheDocument();
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

  const dialog = openSelectedDrawerWorkLogTab();
  fireEvent.change(within(dialog).getByLabelText("Work Log notes"), {
    target: { value: "Replaced failed switch and verified labels print." },
  });
  fireEvent.change(within(dialog).getByLabelText("Time spent"), {
    target: { value: "45" },
  });
  expect(within(dialog).getByRole("button", { name: "Choose an outcome" })).toBeDisabled();
  fireEvent.click(within(dialog).getByLabelText("Complete ticket"));
  expect(within(dialog).getByLabelText("Use Work Log as solution")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByLabelText("Use Work Log as solution"));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Save Work Log and complete ticket" }),
  );

  expect(screen.queryByTestId("timeline-appointment-appt-1")).not.toBeInTheDocument();
  expect(screen.getByText("Work Log saved and ticket resolved locally for test sync.")).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_500);
  });
  expect(
    screen.queryByText("Work Log saved and ticket resolved locally for test sync."),
  ).not.toBeInTheDocument();
});

test("shows the required conditional fields for book forward and transfer", async () => {
  render(await CommandCentrePage());
  fireEvent.click(screen.getByTestId("timeline-appointment-appt-1"));

  const dialog = openSelectedDrawerWorkLogTab();
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

test("refreshes live queue data while Command Centre remains open", async () => {
  render(await CommandCentrePage());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });

  expect(routerRefreshMock).toHaveBeenCalledOnce();
});

test("deduplicates focus and visibility refreshes while a dashboard load is pending", async () => {
  render(await CommandCentrePage());

  window.dispatchEvent(new Event("focus"));
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("focus"));

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
      operationId: "operation-merge-1",
      parentRequestId: "100301",
      status: "queued",
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

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const mergeCall = fetchMock.mock.calls.find(
    ([url]) => url === "/api/internal/msp-central/merge-requests",
  );
  expect(mergeCall).toBeDefined();
  const [url, init] = mergeCall as [string, RequestInit];
  expect(url).toBe("/api/internal/msp-central/merge-requests");
  expect(init.method).toBe("POST");
  expect(JSON.parse(String(init.body))).toMatchObject({
    childRequestId: "100284",
    idempotencyKey: expect.stringMatching(/^merge:/),
    parentRequestId: "100301",
  });
  const childRequestButton = within(screen.getByTestId("request-queue")).getByRole(
    "button",
    { name: "REQ-100284 Packhouse label printer offline" },
  );
  const childRequestCard = childRequestButton.closest("article");
  if (!childRequestCard) throw new Error("Expected the child request card.");
  await waitFor(() =>
    expect(within(childRequestCard).getByText("Syncing")).toBeInTheDocument(),
  );
});

test("renders overlapping timeline appointments in separate visible lanes", async () => {
  render(await CommandCentrePage());

  expect(screen.queryByRole("button", { name: /overlapping appointments/ })).not.toBeInTheDocument();
  expect(screen.getByText("Practice management update")).toBeInTheDocument();
  expect(screen.getByText("Outlook busy: supplier call")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Outlook busy: supplier call/ }));

  const drawer = screen.getByTestId("command-centre-drawer");
  expect(
    within(drawer).getByRole("heading", {
      name: "Outlook busy: supplier call",
    }),
  ).toBeInTheDocument();
});

test("switches the queue between unscheduled and assigned jobs", async () => {
  render(await CommandCentrePage());

  expect(screen.getByRole("button", { name: "Unscheduled queue" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Assigned jobs" }));

  expect(screen.getByRole("heading", { name: "Assigned Jobs" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Assigned jobs" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(within(screen.getByTestId("request-queue")).getAllByRole("article").length).toBeGreaterThan(0);
});

test("opens a queue ticket in the full ticket workspace", async () => {
  render(await CommandCentrePage());

  fireEvent.click(
    within(screen.getByTestId("request-queue")).getByRole("button", {
      name: "Open REQ-100284 ticket workspace",
    }),
  );

  const dialog = screen.getByRole("dialog", { name: "Ticket workspace" });
  expect(within(dialog).getByRole("tab", { name: "Overview" })).toBeInTheDocument();
  expect(within(dialog).getByRole("tab", { name: "Comms" })).toBeInTheDocument();
  expect(within(dialog).getByRole("tab", { name: "Tracks" })).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Work Log" })).toBeInTheDocument();
});

test("opens a queue ticket workspace on double-click", async () => {
  render(await CommandCentrePage());

  fireEvent.doubleClick(
    within(screen.getByTestId("request-queue")).getByRole("button", {
      name: "REQ-100284 Packhouse label printer offline",
    }),
  );

  expect(screen.getByRole("dialog", { name: "Ticket workspace" })).toBeInTheDocument();
});

test("opens a request-backed Day booking workspace on double-click", async () => {
  render(await CommandCentrePage());

  fireEvent.doubleClick(screen.getByTestId("timeline-appointment-appt-1"));

  expect(screen.getByRole("dialog", { name: "Ticket workspace" })).toBeInTheDocument();
});

test("opens a request-backed Week booking workspace on double-click", async () => {
  render(await CommandCentrePage());

  fireEvent.click(screen.getByRole("button", { name: /week/i }));
  fireEvent.doubleClick(
    screen.getByRole("button", {
      name: /File server disk expansion OneHarvest/,
    }),
  );

  expect(screen.getByRole("dialog", { name: "Ticket workspace" })).toBeInTheDocument();
});

test("shows customer emails and clickable external links in Comms", async () => {
  vi.useRealTimers();
  const data = getDispatchDesignMockData();
  const selectedRequest = data.requests[0];
  getTestSyncedDispatchDashboardDataMock.mockResolvedValueOnce({
    ...data,
    dispatchDataSource: "msp-central",
    requests: data.requests.map((request) => ({
      ...request,
      sourceSystem: "msp-central" as const,
    })),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: async () => ({
        customerResponses: [
          {
            author: "Mel Harris",
            body: "Please use Go to job.",
            bodyHtml:
              'Please use <a href="https://jobs.example.com/123">Go to job</a>.',
            id: "response-1",
          },
        ],
        internalNotes: [],
        request: selectedRequest,
        worklogs: [],
      }),
      ok: true,
    }),
  );

  render(await CommandCentrePage());
  fireEvent.click(
    within(screen.getByTestId("request-queue")).getByRole("button", {
      name: "Open REQ-100284 ticket workspace",
    }),
  );
  const dialog = screen.getByRole("dialog", { name: "Ticket workspace" });
  fireEvent.click(within(dialog).getByRole("tab", { name: "Comms" }));

  expect(await within(dialog).findByText("Mel Harris")).toBeInTheDocument();
  expect(within(dialog).getByRole("link", { name: "Go to job" })).toHaveAttribute(
    "href",
    "https://jobs.example.com/123",
  );
  const composer = within(dialog).getByTestId("communication-composer");
  expect(
    within(composer).getByLabelText("Communication message"),
  ).toHaveClass("min-h-56", "w-full");
  expect(within(dialog).getByRole("button", { name: "Send to customer" })).toBeInTheDocument();
});

test("creates a new live Helpdesk request from the queue", async () => {
  vi.useRealTimers();
  const data = getDispatchDesignMockData();
  getTestSyncedDispatchDashboardDataMock.mockResolvedValueOnce({
    ...data,
    dispatchDataSource: "msp-central",
  });
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (String(url).includes("/api/internal/msp-central/lookups")) {
      return Promise.resolve({
        json: async () => ({
          customers: [
            {
              id: "customer-1",
              name: "Example Co",
            },
          ],
        }),
        ok: true,
      });
    }
    if (init?.method === "POST") {
      return Promise.resolve({
        json: async () => ({
          operationId: "operation-create-1",
          pendingRequestId: "pending:create-1",
          status: "queued",
        }),
        ok: true,
      });
    }
    return Promise.resolve({
      json: async () => ({}),
      ok: true,
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(await CommandCentrePage());
  fireEvent.click(screen.getByRole("button", { name: "Create request" }));

  const dialog = screen.getByRole("dialog", { name: "Create request" });
  fireEvent.change(within(dialog).getByLabelText("Subject"), {
    target: { value: "Printer offline" },
  });
  fireEvent.change(within(dialog).getByLabelText("Description"), {
    target: { value: "Printer cannot reach the network." },
  });
  fireEvent.change(within(dialog).getByLabelText("Requester email"), {
    target: { value: "user@example.com" },
  });
  fireEvent.change(within(dialog).getByLabelText("Customer"), {
    target: { value: "Example" },
  });
  fireEvent.click(await within(dialog).findByRole("button", {
    name: /Example Co/i,
  }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Create request" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/internal/msp-central/requests",
      expect.objectContaining({ method: "POST" }),
    ),
  );
  const createCall = fetchMock.mock.calls.find(
    ([url]) => url === "/api/internal/msp-central/requests",
  );
  expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
    idempotencyKey: expect.stringMatching(/^request:/),
    customer: "Example Co",
    customerId: "customer-1",
    subject: "Printer offline",
  });
  expect(
    await screen.findByText("Request creation queued. Syncing with MSP Central."),
  ).toBeInTheDocument();
});

test("creates a live Helpdesk request and immediately opens scheduling", async () => {
  vi.useRealTimers();
  const data = getDispatchDesignMockData();
  getTestSyncedDispatchDashboardDataMock.mockResolvedValueOnce({
    ...data,
    dispatchDataSource: "msp-central",
  });
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (String(url).includes("/api/internal/msp-central/lookups")) {
      return Promise.resolve({
        json: async () => ({
          customers: [
            {
              address: "137 Main Street, Bairnsdale VIC 3875",
              id: "customer-1",
              name: "Example Co",
            },
          ],
        }),
        ok: true,
      });
    }
    if (init?.method === "POST") {
      return Promise.resolve({
        json: async () => ({
          createdRequestId: "6768000001520715",
          createdRequestNumber: "22336",
          operationId: "operation-create-1",
          pendingRequestId: "pending:create-1",
          status: "synced",
        }),
        ok: true,
      });
    }
    return Promise.resolve({
      json: async () => ({}),
      ok: true,
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(await CommandCentrePage());
  fireEvent.click(screen.getByRole("button", { name: "Create request" }));

  const dialog = screen.getByRole("dialog", { name: "Create request" });
  fireEvent.change(within(dialog).getByLabelText("Subject"), {
    target: { value: "Printer offline" },
  });
  fireEvent.change(within(dialog).getByLabelText("Description"), {
    target: { value: "Printer cannot reach the network." },
  });
  fireEvent.change(within(dialog).getByLabelText("Requester email"), {
    target: { value: "user@example.com" },
  });
  fireEvent.change(within(dialog).getByLabelText("Customer"), {
    target: { value: "Example" },
  });
  fireEvent.click(await within(dialog).findByRole("button", {
    name: /Example Co/i,
  }));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Create and schedule" }),
  );

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/internal/msp-central/requests",
      expect.objectContaining({ method: "POST" }),
    ),
  );
  const createCall = fetchMock.mock.calls.find(
    ([url]) => url === "/api/internal/msp-central/requests",
  );
  expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
    customer: "Example Co",
    customerId: "customer-1",
    subject: "Printer offline",
    waitForProvider: true,
  });

  const scheduleDialog = await screen.findByRole("dialog", {
    name: "Schedule request",
  });
  expect(within(scheduleDialog).getByText("22336")).toBeInTheDocument();
  expect(within(scheduleDialog).getByText("Printer offline")).toBeInTheDocument();
});

test("closes request creation and reports durable review state", async () => {
  vi.useRealTimers();
  const data = getDispatchDesignMockData();
  getTestSyncedDispatchDashboardDataMock.mockResolvedValueOnce({
    ...data,
    dispatchDataSource: "msp-central",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes("/api/internal/msp-central/lookups")) {
        return Promise.resolve({
          json: async () => ({
            customers: [
              {
                id: "customer-review",
                name: "Review Customer",
              },
            ],
          }),
          ok: true,
        });
      }
      if (init?.method === "POST") {
        return Promise.resolve({
          json: async () => ({
            operationId: "operation-create-review",
            pendingRequestId: "pending:create-review",
            status: "review_required",
          }),
          ok: true,
        });
      }
      return Promise.resolve({
        json: async () => ({}),
        ok: true,
      });
    }),
  );

  render(await CommandCentrePage());
  fireEvent.click(screen.getByRole("button", { name: "Create request" }));
  const dialog = screen.getByRole("dialog", { name: "Create request" });
  fireEvent.change(within(dialog).getByLabelText("Subject"), {
    target: { value: "Printer offline" },
  });
  fireEvent.change(within(dialog).getByLabelText("Customer"), {
    target: { value: "Review" },
  });
  fireEvent.click(await within(dialog).findByRole("button", {
    name: /Review Customer/i,
  }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Create request" }));

  expect(
    await screen.findByText("Request saved locally. Provider sync needs review."),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("dialog", { name: "Create request" }),
  ).not.toBeInTheDocument();
});

test("closes communication workspace and reports durable review state", async () => {
  vi.useRealTimers();
  const data = getDispatchDesignMockData();
  const selectedRequest = data.requests[0];
  getTestSyncedDispatchDashboardDataMock.mockResolvedValueOnce({
    ...data,
    dispatchDataSource: "msp-central",
    requests: data.requests.map((request) => ({
      ...request,
      sourceSystem: "msp-central" as const,
    })),
  });
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return {
        json: async () => ({
          operationId: "operation-comms-review",
          status: "review_required",
        }),
        ok: true,
      };
    }
    return {
      json: async () => ({
        customerResponses: [],
        internalNotes: [],
        request: selectedRequest,
        worklogs: [],
      }),
      ok: true,
    };
  });
  vi.stubGlobal("fetch", fetchMock);

  render(await CommandCentrePage());
  fireEvent.click(
    within(screen.getByTestId("request-queue")).getByRole("button", {
      name: "Open REQ-100284 ticket workspace",
    }),
  );
  const dialog = screen.getByRole("dialog", { name: "Ticket workspace" });
  fireEvent.click(within(dialog).getByRole("tab", { name: "Comms" }));
  fireEvent.change(within(dialog).getByLabelText("Communication message"), {
    target: { value: "Please restart the printer." },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Send to customer" }));

  expect(
    await screen.findByText(
      "Communication saved locally. Provider sync needs review.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("dialog", { name: "Ticket workspace" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Review required" })).toHaveAttribute(
    "href",
    "/integrations",
  );
});

test("turns safe external links in request content into clickable links", () => {
  expect(
    safeRequestContentParts(
      'Open <a href="https://jobs.example.com/123">Go to job</a> or https://portal.example.com.',
    ),
  ).toEqual([
    { text: "Open " },
    { href: "https://jobs.example.com/123", text: "Go to job" },
    { text: " or " },
    { href: "https://portal.example.com/", text: "https://portal.example.com" },
    { text: "." },
  ]);
});

test("collapses Helpdesk email layout whitespace while keeping action links", () => {
  const parts = safeRequestContentParts(`
    <table>
      <tr><td>




        Customer Job #: 06148405




        <a href="https://links.amtek.au/ls/click?upn=u001.LONG-LINK">Go to job</a>




        <a href="https://links.amtek.au/ls/click?upn=u002.LONG-LINK">Take this job</a>




      </td></tr>
    </table>
  `);

  expect(parts).toEqual([
    { text: "Customer Job #: 06148405\n\n" },
    { href: "https://links.amtek.au/ls/click?upn=u001.LONG-LINK", text: "Go to job" },
    { text: "\n\n" },
    {
      href: "https://links.amtek.au/ls/click?upn=u002.LONG-LINK",
      text: "Take this job",
    },
  ]);
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
  expect(screen.getByTestId("timeline-appointment-appt-3")).toHaveAttribute(
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
  expect(screen.getByTestId("timeline-appointment-appt-3")).toHaveAttribute(
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
  expect(screen.getByTestId("timeline-appointment-appt-3")).toHaveAttribute(
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

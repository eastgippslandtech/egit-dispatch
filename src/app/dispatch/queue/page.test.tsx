import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { getDispatchDesignMockData } from "@/server/dispatch/mock-data";
import { getTestSyncedDispatchDashboardData } from "@/server/dispatch/test-sync-dashboard";
import { getConfiguredRequestNicknameRepository } from "@/server/dispatch/request-nickname-repository";

import DispatchQueuePage from "./page";
import { DispatchQueueScreen } from "./queue-screen";
import { QueueScheduleModal } from "./queue-schedule-modal";

const routerRefresh = vi.fn();
const routerPush = vi.fn();

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

vi.mock("@/server/dispatch/test-sync-dashboard", () => ({
  getTestSyncedDispatchDashboardData: vi.fn(),
}));
vi.mock("@/server/dispatch/request-nickname-repository", () => ({
  getConfiguredRequestNicknameRepository: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
  useRouter: () => ({ refresh: routerRefresh, push: routerPush }),
}));

const getAccess = vi.mocked(getCommandCentreAccess);
const getDashboard = vi.mocked(getTestSyncedDispatchDashboardData);
const getNicknameRepository = vi.mocked(getConfiguredRequestNicknameRepository);

beforeEach(() => {
  vi.clearAllMocks();
  getAccess.mockResolvedValue({
    accessLevel: "staff",
    email: "simeon@egit.com.au",
    name: "Simeon",
    status: "approved",
  });
  getDashboard.mockResolvedValue(getDispatchDesignMockData());
  getNicknameRepository.mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("renders the separate operational queue with board navigation", async () => {
  render(await DispatchQueuePage());

  expect(screen.getByRole("heading", { level: 1, name: "Dispatch Queue" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Dispatch Board" })).toHaveAttribute("href", "/dispatch");
  expect(screen.getByRole("button", { name: /Unscheduled/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: /My Queue/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Updated/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Failed Sync/ })).toBeInTheDocument();
});

test("loads the shared nickname in queue rows, preview, search, and ticket workspace", async () => {
  const request = getDispatchDesignMockData().requests.find(
    (candidate) => candidate.subject === "Packhouse label printer offline",
  );
  if (!request) throw new Error("Expected queue request fixture.");
  getNicknameRepository.mockReturnValue({
    list: vi.fn().mockResolvedValue({ [request.id]: "Front counter printer" }),
    set: vi.fn(),
  });

  render(await DispatchQueuePage());

  const row = screen.getByRole("article", { name: /Front counter printer/ });
  expect(within(row).getByText("Front counter printer")).toBeInTheDocument();
  expect(within(row).getByText(request.subject)).toBeInTheDocument();
  expect(within(screen.getAllByRole("complementary").at(-1)!).getByText("Front counter printer")).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText("Search requests"), {
    target: { value: "Front counter printer" },
  });
  expect(screen.getAllByRole("article")).toHaveLength(1);
  fireEvent.click(within(row).getByRole("button", { name: "Open workspace" }));
  const workspace = screen.getByRole("dialog", { name: "Ticket workspace" });
  expect(within(workspace).getByRole("heading", { name: "Front counter printer" })).toBeInTheDocument();
  expect(within(workspace).getByRole("button", { name: "Edit nickname" })).toBeInTheDocument();
});

test("saves a nickname from Dispatch Queue and updates the queue immediately", async () => {
  const data = getDispatchDesignMockData();
  const request = data.requests.find(
    (candidate) => candidate.subject === "Packhouse label printer offline",
  );
  if (!request) throw new Error("Expected queue request fixture.");
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
    JSON.stringify({ nickname: "Front counter printer" }),
    { headers: { "Content-Type": "application/json" }, status: 200 },
  ));
  const { rerender } = render(await DispatchQueuePage());

  const row = screen.getByRole("article", { name: /Packhouse label printer offline/ });
  fireEvent.click(within(row).getByRole("button", { name: "Open workspace" }));
  const workspace = screen.getByRole("dialog", { name: "Ticket workspace" });
  fireEvent.click(within(workspace).getByRole("button", { name: "Edit nickname" }));
  fireEvent.change(within(workspace).getByRole("textbox", { name: "Ticket nickname" }), {
    target: { value: "Front counter printer" },
  });
  fireEvent.click(within(workspace).getByRole("button", { name: "Save nickname" }));

  await waitFor(() => expect(within(row).getByText("Front counter printer")).toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledWith(
    `/api/internal/dispatch/requests/${encodeURIComponent(request.id)}/nickname`,
    expect.objectContaining({ method: "PUT" }),
  );
  expect(routerRefresh).toHaveBeenCalled();

  getDashboard.mockResolvedValue({
    ...data,
    requests: data.requests.map((candidate) => candidate.id === request.id
      ? { ...candidate, nickname: "Front counter printer" }
      : candidate),
  });
  rerender(await DispatchQueuePage());
  await waitFor(() => expect(within(screen.getByRole("article", { name: /Front counter printer/ })).getByText("Front counter printer")).toBeInTheDocument());

  getDashboard.mockResolvedValue({
    ...data,
    requests: data.requests.map((candidate) => candidate.id === request.id
      ? { ...candidate, nickname: "Updated on Dispatch Board" }
      : candidate),
  });
  rerender(await DispatchQueuePage());
  await waitFor(() => expect(within(screen.getByRole("article", { name: /Updated on Dispatch Board/ })).getByText("Updated on Dispatch Board")).toBeInTheDocument());
  fetchMock.mockRestore();
});

test("accepts a nickname changed on the Dispatch Board when queue data refreshes", () => {
  const data = getDispatchDesignMockData();
  const request = data.requests.find((candidate) => candidate.subject === "Packhouse label printer offline");
  if (!request) throw new Error("Expected queue request fixture.");
  const props = { authDisabled: true, currentTechnicianId: undefined, showIntegrations: false };
  const { rerender } = render(<DispatchQueueScreen {...props} data={data} />);

  rerender(<DispatchQueueScreen {...props} data={{
    ...data,
    requests: data.requests.map((candidate) => candidate.id === request.id
      ? { ...candidate, nickname: "Board nickname" }
      : candidate),
  }} />);

  expect(within(screen.getByRole("article", { name: /Board nickname/ })).getByText("Board nickname")).toBeInTheDocument();
});

test("shows the nickname in the queue scheduling screen", async () => {
  const data = getDispatchDesignMockData();
  const request = data.requests.find((candidate) => candidate.subject === "Packhouse label printer offline");
  if (!request) throw new Error("Expected queue request fixture.");
  getDashboard.mockResolvedValue({
    ...data,
    requests: data.requests.map((candidate) => candidate.id === request.id
      ? { ...candidate, nickname: "Front counter printer" }
      : candidate),
  });
  render(await DispatchQueuePage());

  const row = screen.getByRole("article", { name: /Front counter printer/ });
  fireEvent.click(within(row).getByRole("button", { name: "Schedule" }));

  const dialog = screen.getByRole("dialog", { name: "Schedule request" });
  expect(within(dialog).getByText("Front counter printer")).toBeInTheDocument();
  expect(within(dialog).getByText(request.subject)).toBeInTheDocument();
});

test("clears a queue nickname and restores the original subject", async () => {
  const data = getDispatchDesignMockData();
  const request = data.requests.find((candidate) => candidate.subject === "Packhouse label printer offline");
  if (!request) throw new Error("Expected queue request fixture.");
  getDashboard.mockResolvedValue({
    ...data,
    requests: data.requests.map((candidate) => candidate.id === request.id
      ? { ...candidate, nickname: "Front counter printer" }
      : candidate),
  });
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
    JSON.stringify({ nickname: null }),
    { headers: { "Content-Type": "application/json" }, status: 200 },
  ));
  render(await DispatchQueuePage());

  const row = screen.getByRole("article", { name: /Front counter printer/ });
  fireEvent.click(within(row).getByRole("button", { name: "Open workspace" }));
  const workspace = screen.getByRole("dialog", { name: "Ticket workspace" });
  fireEvent.click(within(workspace).getByRole("button", { name: "Edit nickname" }));
  fireEvent.click(within(workspace).getByRole("button", { name: "Clear nickname" }));

  await waitFor(() => expect(within(row).queryByText("Front counter printer")).not.toBeInTheDocument());
  expect(within(row).getByText(request.subject)).toBeInTheDocument();
  fetchMock.mockRestore();
});

test("retains the queue nickname when the save fails", async () => {
  const data = getDispatchDesignMockData();
  const request = data.requests.find((candidate) => candidate.subject === "Packhouse label printer offline");
  if (!request) throw new Error("Expected queue request fixture.");
  getDashboard.mockResolvedValue({
    ...data,
    requests: data.requests.map((candidate) => candidate.id === request.id
      ? { ...candidate, nickname: "Front counter printer" }
      : candidate),
  });
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
    JSON.stringify({ error: "Database unavailable" }),
    { headers: { "Content-Type": "application/json" }, status: 500 },
  ));
  render(await DispatchQueuePage());

  const row = screen.getByRole("article", { name: /Front counter printer/ });
  fireEvent.click(within(row).getByRole("button", { name: "Open workspace" }));
  const workspace = screen.getByRole("dialog", { name: "Ticket workspace" });
  fireEvent.click(within(workspace).getByRole("button", { name: "Edit nickname" }));
  fireEvent.change(within(workspace).getByRole("textbox", { name: "Ticket nickname" }), {
    target: { value: "Front counter scanner" },
  });
  fireEvent.click(within(workspace).getByRole("button", { name: "Save nickname" }));

  expect(await within(workspace).findByRole("alert")).toHaveTextContent("Database unavailable");
  expect(within(row).getByText("Front counter printer")).toBeInTheDocument();
  fetchMock.mockRestore();
});

test("switches to the signed-in technician queue", async () => {
  render(await DispatchQueuePage());

  fireEvent.click(screen.getByRole("button", { name: /My Queue/ }));

  expect(screen.getByRole("heading", { name: "My Queue" })).toBeInTheDocument();
  expect(screen.getByText("Network cabinet tidy and patch audit")).toBeInTheDocument();
  expect(screen.queryByText("Packhouse label printer offline")).not.toBeInTheDocument();
});

test("opens scheduling inside the queue from the shared ticket workspace", async () => {
  render(await DispatchQueuePage());

  const row = screen.getByRole("article", { name: /Packhouse label printer offline/ });
  fireEvent.click(within(row).getByRole("button", { name: "Open workspace" }));

  const workspace = screen.getByRole("dialog", { name: "Ticket workspace" });
  expect(within(workspace).getByRole("tab", { name: "Overview" })).toBeInTheDocument();
  expect(within(workspace).getByRole("tab", { name: "Comms" })).toBeInTheDocument();
  expect(within(workspace).getByRole("tab", { name: "Tracks" })).toBeInTheDocument();
  fireEvent.click(within(workspace).getByRole("button", { name: "Schedule" }));
  expect(screen.getByRole("dialog", { name: "Schedule request" })).toBeInTheDocument();
  expect(screen.getByLabelText("Booking date")).toBeInTheDocument();
  expect(routerPush).not.toHaveBeenCalled();
});

test("opens rescheduling inside the queue for an assigned appointment", async () => {
  render(await DispatchQueuePage());

  fireEvent.click(screen.getByRole("button", { name: /Assigned/ }));
  const row = screen.getByRole("article", { name: /File server disk expansion/ });
  expect(within(row).getByText("Wed 8 July · 09:30–10:45")).toBeInTheDocument();
  fireEvent.click(within(row).getByRole("button", { name: "Reschedule" }));

  expect(screen.getByRole("dialog", { name: "Move appointment" })).toBeInTheDocument();
  expect(screen.getByLabelText("Booking date")).toHaveValue("2026-07-08");
  expect(routerPush).not.toHaveBeenCalled();
});

test("confirms a schedule from the queue and refreshes it in place", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}", { status: 200 }));
  render(await DispatchQueuePage());

  const row = screen.getByRole("article", {
    name: /Packhouse label printer offline/,
  });
  fireEvent.click(within(row).getByRole("button", { name: "Schedule" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm mock schedule" }),
  );

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/internal/dispatch/test-sync/events",
      expect.objectContaining({ method: "POST" }),
    ),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Schedule request" }),
    ).not.toBeInTheDocument(),
  );
  expect(routerRefresh).toHaveBeenCalled();
  expect(routerPush).not.toHaveBeenCalled();

  fetchMock.mockRestore();
});

test("accepts a live queue schedule locally when provider confirmation stalls", async () => {
  const data = getDispatchDesignMockData();
  const request = { ...data.requests[0], sourceSystem: "msp-central" as const };
  const onScheduled = vi.fn();
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => new Promise<Response>(() => undefined));

  render(
    <QueueScheduleModal
      dashboard={{
        ...data,
        calendarDataSource: "outlook",
        calendarReadOnly: false,
        dispatchDataSource: "msp-central",
        requests: [request],
      }}
      request={request}
      onCancel={vi.fn()}
      onScheduled={onScheduled}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Confirm schedule" }));

  await waitFor(() =>
    expect(onScheduled).toHaveBeenCalledWith(
      `${request.requestNumber} saved in Command Centre. Syncing with MSP Central and Outlook.`,
    ),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/internal/dispatch/live-schedule",
    expect.objectContaining({ method: "POST" }),
  );

  fetchMock.mockRestore();
});

test("opens a queue request workspace on double-click", async () => {
  render(await DispatchQueuePage());

  fireEvent.doubleClick(
    screen.getByRole("article", { name: /Packhouse label printer offline/ }),
  );

  expect(screen.getByRole("dialog", { name: "Ticket workspace" })).toBeInTheDocument();
});

test("applies a ticket template and resolves Track items in the workspace", async () => {
  render(await DispatchQueuePage());

  const row = screen.getByRole("article", { name: /Packhouse label printer offline/ });
  fireEvent.click(within(row).getByRole("button", { name: "Open workspace" }));
  const workspace = screen.getByRole("dialog", { name: "Ticket workspace" });
  fireEvent.click(within(workspace).getByRole("tab", { name: "Tracks" }));
  fireEvent.click(within(workspace).getByRole("button", { name: "Apply ticket template" }));

  expect(within(workspace).getByText("General support Track")).toBeInTheDocument();
  expect(within(workspace).getByText("0/3")).toBeInTheDocument();
  const firstStep = within(workspace)
    .getByText("Confirm the requested outcome")
    .closest("article");
  if (!firstStep) throw new Error("Expected first Track step.");
  fireEvent.change(within(firstStep).getByLabelText(/Confirm the requested outcome value/), {
    target: { value: "Printer returns to normal operation" },
  });
  fireEvent.click(within(firstStep).getByRole("button", { name: "Complete" }));
  expect(within(workspace).getByText("1/3")).toBeInTheDocument();

  const secondStep = within(workspace)
    .getByText("Complete and test the technical work")
    .closest("article");
  if (!secondStep) throw new Error("Expected second Track step.");
  fireEvent.click(within(secondStep).getByRole("button", { name: "Not applicable" }));
  expect(within(workspace).getByText(/reason is required/i)).toBeInTheDocument();
});

test("collapses the request preview before it can clip queue actions", async () => {
  render(await DispatchQueuePage());

  const preview = screen.getAllByRole("complementary").at(-1);
  expect(preview).toHaveClass("max-2xl:hidden");
});

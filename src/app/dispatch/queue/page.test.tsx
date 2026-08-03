import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { getDispatchDesignMockData } from "@/server/dispatch/mock-data";
import { getTestSyncedDispatchDashboardData } from "@/server/dispatch/test-sync-dashboard";

import DispatchQueuePage from "./page";

const routerRefresh = vi.fn();
const routerPush = vi.fn();

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
  useRouter: () => ({ refresh: routerRefresh, push: routerPush }),
}));

const getAccess = vi.mocked(getCommandCentreAccess);
const getDashboard = vi.mocked(getTestSyncedDispatchDashboardData);

beforeEach(() => {
  vi.clearAllMocks();
  getAccess.mockResolvedValue({
    accessLevel: "staff",
    email: "simeon@egit.com.au",
    name: "Simeon",
    status: "approved",
  });
  getDashboard.mockResolvedValue(getDispatchDesignMockData());
});

test("renders the separate operational queue with board navigation", async () => {
  render(await DispatchQueuePage());

  expect(screen.getByRole("heading", { level: 1, name: "Dispatch Queue" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Dispatch Board" })).toHaveAttribute("href", "/dispatch");
  expect(screen.getByRole("button", { name: /New \/ Unassigned/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: /My Queue/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Updated/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Failed Sync/ })).toBeInTheDocument();
});

test("switches to the signed-in technician queue", async () => {
  render(await DispatchQueuePage());

  fireEvent.click(screen.getByRole("button", { name: /My Queue/ }));

  expect(screen.getByRole("heading", { name: "My Queue" })).toBeInTheDocument();
  expect(screen.getByText("Network cabinet tidy and patch audit")).toBeInTheDocument();
  expect(screen.queryByText("Packhouse label printer offline")).not.toBeInTheDocument();
});

test("opens the shared ticket workspace and hands scheduling to the board", async () => {
  render(await DispatchQueuePage());

  const row = screen.getByRole("article", { name: /Packhouse label printer offline/ });
  fireEvent.click(within(row).getByRole("button", { name: "Open workspace" }));

  const workspace = screen.getByRole("dialog", { name: "Ticket workspace" });
  expect(within(workspace).getByRole("tab", { name: "Overview" })).toBeInTheDocument();
  expect(within(workspace).getByRole("tab", { name: "Comms" })).toBeInTheDocument();
  expect(within(workspace).getByRole("tab", { name: "Tracks" })).toBeInTheDocument();
  fireEvent.click(within(workspace).getByRole("button", { name: "Schedule" }));
  expect(routerPush).toHaveBeenCalledWith("/dispatch?requestId=100284");
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

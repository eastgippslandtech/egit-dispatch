import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const { signOutMock } = vi.hoisted(() => ({ signOutMock: vi.fn() }));

import {
  getCommandCentreAccess,
  getWallboardAccess,
} from "@/server/auth/session";
import { todayDateKey } from "@/server/dispatch/date-scope";
import { getDispatchDesignMockData } from "@/server/dispatch/mock-data";
import { getWallboardSnapshot } from "@/server/presence/service";
import WallboardPage from "./page";

vi.mock("@/server/auth/session", () => ({
  getCommandCentreAccess: vi.fn(),
  getWallboardAccess: vi.fn(),
}));
vi.mock("@/server/presence/service", () => ({
  getWallboardSnapshot: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
}));
vi.mock("next-auth/react", () => ({ signOut: signOutMock }));

const commandCentreAccessMock = vi.mocked(getCommandCentreAccess);
const wallboardAccessMock = vi.mocked(getWallboardAccess);
const snapshotMock = vi.mocked(getWallboardSnapshot);

beforeEach(() => {
  vi.clearAllMocks();
  const staffAccess = {
    accessLevel: "staff",
    email: "simeon@egit.com.au",
    name: "Simeon",
    status: "approved",
  } as const;
  commandCentreAccessMock.mockResolvedValue(staffAccess);
  wallboardAccessMock.mockResolvedValue({
    ...staffAccess,
    accessLevel: "staff",
  });
  const dashboard = getDispatchDesignMockData();
  snapshotMock.mockResolvedValue({
    dashboard,
    peopleStatus: "not_configured",
    presences: dashboard.technicians.map((technician, index) => ({
      conflicts: [],
      context: index === 0 ? "To OneHarvest" : technician.storeLocation,
      endsAt: index === 0 ? "2026-07-08T10:00:00+10:00" : undefined,
      label: index === 0 ? "Driving" : "In office",
      source: "schedule",
      status: index === 0 ? "driving" : "in_office",
      technicianId: technician.id,
    })),
    sourceWarnings: [],
    weeklyExternalTalkSeconds: {
      "tech-matt": 3 * 3600 + 42 * 60,
    },
    updatedAt: "2026-07-08T00:00:00.000Z",
  });
});

test("renders a full-width wallboard with team presence and no dispatcher sidebars", async () => {
  render(await WallboardPage());

  expect(
    screen.getByRole("heading", { level: 1, name: "Command Centre Wallboard" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Team status" })).toBeInTheDocument();
  expect(screen.getByText("Driving")).toBeInTheDocument();
  expect(screen.getByText("To OneHarvest")).toBeInTheDocument();
  expect(screen.getByText("3h 42m this week")).toBeInTheDocument();
  expect(screen.getAllByText("In office")).toHaveLength(3);
  expect(screen.getByTestId("presence-tech-matt")).toHaveAttribute(
    "data-presence-status",
    "driving",
  );
  expect(screen.getByTestId("presence-tech-matt")).toHaveClass(
    "bg-sky-500/35",
    "border-2",
  );
  expect(screen.getByTestId("presence-tech-jervy")).toHaveClass(
    "bg-emerald-500/35",
  );
  expect(screen.getByText("Technician timeline")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Dispatch" })).toHaveAttribute(
    "href",
    "/dispatch",
  );
  expect(screen.getByTestId("timeline-viewport")).toBeInTheDocument();
  expect(screen.queryByText("Unscheduled Requests")).not.toBeInTheDocument();
  expect(screen.queryByTestId("command-centre-drawer")).not.toBeInTheDocument();
  expect(screen.queryByPlaceholderText("Search requests")).not.toBeInTheDocument();
});

test("shows overlapping wallboard bookings in separate vertical lanes", async () => {
  const dashboard = getDispatchDesignMockData();
  const technician = dashboard.technicians[0];
  dashboard.appointments = [
    {
      customer: "Customer A",
      date: todayDateKey(),
      end: "11:30",
      id: "wallboard-overlap-a",
      readOnly: true,
      source: "outlook",
      start: "10:00",
      status: "confirmed",
      technicianId: technician.id,
      title: "First overlapping job",
    },
    {
      customer: "Customer B",
      date: todayDateKey(),
      end: "12:00",
      id: "wallboard-overlap-b",
      readOnly: true,
      source: "outlook",
      start: "10:30",
      status: "confirmed",
      technicianId: technician.id,
      title: "Second overlapping job",
    },
  ];
  snapshotMock.mockResolvedValue({
    dashboard,
    peopleStatus: "not_configured",
    presences: dashboard.technicians.map((candidate) => ({
      conflicts: [],
      context: candidate.storeLocation,
      label: "In office",
      source: "schedule",
      status: "in_office",
      technicianId: candidate.id,
    })),
    sourceWarnings: [],
    updatedAt: new Date().toISOString(),
  });

  render(await WallboardPage());

  const first = screen.getByTestId(
    "timeline-appointment-wallboard-overlap-a",
  );
  const second = screen.getByTestId(
    "timeline-appointment-wallboard-overlap-b",
  );
  expect(first).toBeInTheDocument();
  expect(second).toBeInTheDocument();
  expect(
    screen.queryByTestId("timeline-overlap-wallboard-overlap-a"),
  ).not.toBeInTheDocument();
  expect(first.style.top).not.toBe(second.style.top);
});

test("renders the wallboard for a signed wallboard session", async () => {
  commandCentreAccessMock.mockResolvedValue({
    name: "Command Centre Wallboard",
    status: "wallboard-only",
  });
  wallboardAccessMock.mockResolvedValue({
    accessLevel: "wallboard",
    name: "Command Centre Wallboard",
    status: "approved",
  });

  render(await WallboardPage());

  expect(
    screen.getByRole("heading", { level: 1, name: "Command Centre Wallboard" }),
  ).toBeInTheDocument();
  expect(wallboardAccessMock).toHaveBeenCalledOnce();
  expect(commandCentreAccessMock).not.toHaveBeenCalled();
});

test("hides Dispatch and returns local sessions to wallboard sign-in on sign-out", async () => {
  wallboardAccessMock.mockResolvedValue({
    accessLevel: "wallboard",
    name: "Command Centre Wallboard",
    status: "approved",
  });

  render(await WallboardPage());

  expect(screen.queryByRole("link", { name: "Dispatch" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(signOutMock).toHaveBeenCalledWith({
    callbackUrl: "/auth/wallboard-sign-in",
  });
});

test("redirects unauthenticated wallboard viewers to local wallboard sign in", async () => {
  commandCentreAccessMock.mockResolvedValue({ status: "unauthenticated" });
  wallboardAccessMock.mockResolvedValue({ status: "unauthenticated" });

  await expect(WallboardPage()).rejects.toThrow(
    "NEXT_REDIRECT:/auth/wallboard-sign-in",
  );
});

test("blocks Zoho users outside the Command Centre allowlist", async () => {
  const access = {
    email: "external@example.com",
    name: "External",
    status: "not-approved",
  } as const;
  commandCentreAccessMock.mockResolvedValue(access);
  wallboardAccessMock.mockResolvedValue(access);

  render(await WallboardPage());

  expect(
    screen.getByRole("heading", { name: "Access not approved" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Team status")).not.toBeInTheDocument();
});

test.each([
  { expected: "90m remaining", minutes: 90 },
  { expected: "1h 31m remaining", minutes: 91 },
  { expected: "2h remaining", minutes: 120 },
  { expected: "2h 30m remaining", minutes: 150 },
  { expected: "1d remaining", minutes: 1_440 },
  { expected: "1d 1h remaining", minutes: 1_499 },
  { expected: "1d 2h remaining", minutes: 1_560 },
])(
  "formats a $minutes minute staff status as $expected",
  async ({ expected, minutes }) => {
    const now = new Date();
    const dashboard = getDispatchDesignMockData();
    snapshotMock.mockResolvedValue({
      dashboard,
      peopleStatus: "not_configured",
      presences: dashboard.technicians.map((technician, index) => ({
        conflicts: [],
        context: technician.storeLocation,
        endsAt:
          index === 0
            ? new Date(now.getTime() + minutes * 60_000).toISOString()
            : undefined,
        label: index === 0 ? "On site" : "In office",
        source: "schedule",
        status: index === 0 ? "on_site" : "in_office",
        technicianId: technician.id,
      })),
      sourceWarnings: [],
      updatedAt: now.toISOString(),
    });

    render(await WallboardPage());

    expect(screen.getByText(expected)).toBeInTheDocument();
  },
);

test("does not show a remaining duration for an invalid status end time", async () => {
  const dashboard = getDispatchDesignMockData();
  snapshotMock.mockResolvedValue({
    dashboard,
    peopleStatus: "not_configured",
    presences: dashboard.technicians.map((technician, index) => ({
      conflicts: [],
      context: technician.storeLocation,
      endsAt: index === 0 ? "not-a-date" : undefined,
      label: index === 0 ? "On site" : "In office",
      source: "schedule",
      status: index === 0 ? "on_site" : "in_office",
      technicianId: technician.id,
    })),
    sourceWarnings: [],
    updatedAt: new Date().toISOString(),
  });

  render(await WallboardPage());

  expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
});

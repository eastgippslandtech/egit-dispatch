import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

import {
  getCommandCentreAccess,
  getWallboardAccess,
} from "@/server/auth/session";
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
  expect(screen.getAllByText("In office")).toHaveLength(3);
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

test("redirects unauthenticated wallboard viewers to Zoho sign in", async () => {
  commandCentreAccessMock.mockResolvedValue({ status: "unauthenticated" });
  wallboardAccessMock.mockResolvedValue({ status: "unauthenticated" });

  await expect(WallboardPage()).rejects.toThrow(
    "NEXT_REDIRECT:/auth/sign-in?callbackUrl=/wallboard",
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

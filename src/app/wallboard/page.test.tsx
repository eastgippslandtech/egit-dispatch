import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { getDispatchDesignMockData } from "@/server/dispatch/mock-data";
import { getWallboardSnapshot } from "@/server/presence/service";
import WallboardPage from "./page";

vi.mock("@/server/auth/session", () => ({
  getCommandCentreAccess: vi.fn(),
}));
vi.mock("@/server/presence/service", () => ({
  getWallboardSnapshot: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
}));

const accessMock = vi.mocked(getCommandCentreAccess);
const snapshotMock = vi.mocked(getWallboardSnapshot);

beforeEach(() => {
  accessMock.mockResolvedValue({
    email: "simeon@egit.com.au",
    name: "Simeon",
    status: "approved",
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
  expect(screen.getByTestId("timeline-viewport")).toBeInTheDocument();
  expect(screen.queryByText("Unscheduled Requests")).not.toBeInTheDocument();
  expect(screen.queryByTestId("command-centre-drawer")).not.toBeInTheDocument();
  expect(screen.queryByPlaceholderText("Search requests")).not.toBeInTheDocument();
});

test("redirects unauthenticated wallboard viewers to Zoho sign in", async () => {
  accessMock.mockResolvedValue({ status: "unauthenticated" });

  await expect(WallboardPage()).rejects.toThrow(
    "NEXT_REDIRECT:/auth/sign-in?callbackUrl=/wallboard",
  );
});

test("blocks Zoho users outside the Command Centre allowlist", async () => {
  accessMock.mockResolvedValue({
    email: "external@example.com",
    name: "External",
    status: "not-approved",
  });

  render(await WallboardPage());

  expect(
    screen.getByRole("heading", { name: "Access not approved" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Team status")).not.toBeInTheDocument();
});

import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";

import DispatchPage from "./page";

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
  useRouter: () => ({ refresh: vi.fn() }),
}));

const getCommandCentreAccessMock = vi.mocked(getCommandCentreAccess);

beforeEach(() => {
  getCommandCentreAccessMock.mockResolvedValue({
    status: "approved",
    accessLevel: "staff",
    email: "simeon@egit.com.au",
    name: "Simeon",
  });
});

test("renders the main Command Centre dispatch route", async () => {
  render(await DispatchPage());

  expect(
    screen.getByRole("heading", { level: 1, name: "Command Centre" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Dispatch Health")).toBeInTheDocument();
  expect(screen.getAllByText("Unscheduled Requests").length).toBeGreaterThan(0);
  expect(screen.getByText("Technician timeline")).toBeInTheDocument();
  expect(screen.getByText("No Sample Data")).toBeInTheDocument();
  expect(screen.getByText("No matching requests")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "No selection" })).toBeInTheDocument();
  expect(screen.queryByText("OneHarvest")).not.toBeInTheDocument();
  expect(screen.queryByText("Packhouse label printer offline")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
});

test("redirects unauthenticated users to Zoho sign in", async () => {
  getCommandCentreAccessMock.mockResolvedValue({ status: "unauthenticated" });

  await expect(DispatchPage()).rejects.toThrow(
    "NEXT_REDIRECT:/auth/sign-in?callbackUrl=/dispatch",
  );
});

test("blocks Zoho users who are not on the allowlist", async () => {
  getCommandCentreAccessMock.mockResolvedValue({
    status: "not-approved",
    email: "external@example.com",
    name: "External",
  });

  render(await DispatchPage());

  expect(
    screen.getByRole("heading", { name: "Access not approved" }),
  ).toBeInTheDocument();
  expect(screen.getByText("External / external@example.com")).toBeInTheDocument();
  expect(screen.queryByText("Technician timeline")).not.toBeInTheDocument();
});

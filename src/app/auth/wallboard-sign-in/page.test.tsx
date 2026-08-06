import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("@/server/auth/wallboard-login", () => ({
  isWallboardLoginConfigured: vi.fn(),
}));
vi.mock("./actions", () => ({ wallboardSignIn: vi.fn() }));

import { isWallboardLoginConfigured } from "@/server/auth/wallboard-login";

import WallboardSignInPage from "./page";

const isWallboardLoginConfiguredMock = vi.mocked(isWallboardLoginConfigured);

beforeEach(() => {
  isWallboardLoginConfiguredMock.mockReturnValue(true);
});

test("renders the local wallboard sign-in form with the staff Zoho link", async () => {
  render(await WallboardSignInPage({ searchParams: Promise.resolve({}) }));

  expect(
    screen.getByRole("heading", { name: "Wallboard sign in" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Username")).toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toHaveAttribute(
    "type",
    "password",
  );
  expect(
    screen.getByRole("button", { name: "Sign in to Wallboard" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("link", { name: "Staff sign in with Zoho" }),
  ).toHaveAttribute("href", "/auth/sign-in");
  expect(screen.queryByText(/sign up/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/password reset/i)).not.toBeInTheDocument();
});

test("shows the generic invalid credentials message", async () => {
  render(
    await WallboardSignInPage({
      searchParams: Promise.resolve({ error: "invalid" }),
    }),
  );

  expect(
    screen.getByText("Sign-in details were not accepted."),
  ).toBeInTheDocument();
});

test("clearly disables local sign-in when it is not configured", async () => {
  isWallboardLoginConfiguredMock.mockReturnValue(false);

  render(await WallboardSignInPage({ searchParams: Promise.resolve({}) }));

  expect(
    screen.getByText(
      "Local wallboard sign-in is unavailable. Contact an administrator to configure it.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Sign in to Wallboard" }),
  ).toBeDisabled();
  expect(screen.getByLabelText("Username")).toBeDisabled();
  expect(screen.getByLabelText("Password")).toBeDisabled();
});

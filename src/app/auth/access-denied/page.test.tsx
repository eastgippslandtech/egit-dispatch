import { render, screen } from "@testing-library/react";

import { AccessNotApproved, AuthenticationProblem } from "../auth-screen";

test("renders friendly access not approved screen", () => {
  render(<AccessNotApproved email="external@example.com" name="External" />);

  expect(
    screen.getByRole("heading", { name: "Access not approved" }),
  ).toBeInTheDocument();
  expect(screen.getByText("External / external@example.com")).toBeInTheDocument();
});

test("offers a clean restart when the Zoho callback expires", () => {
  render(<AuthenticationProblem />);

  expect(
    screen.getByRole("heading", { name: "Sign-in needs restarting" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Start sign-in again" })).toHaveAttribute(
    "href",
    "/auth/sign-in",
  );
});

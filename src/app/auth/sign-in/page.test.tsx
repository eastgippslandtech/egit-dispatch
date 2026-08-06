import { render, screen } from "@testing-library/react";

import SignInPage from "./page";

test("renders staff and wallboard sign-in choices without exposing password fields", () => {
  render(<SignInPage />);

  expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign in with Zoho" })).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Wallboard login" }),
  ).toHaveAttribute("href", "/auth/wallboard-sign-in");
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/sign up/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/username/i)).not.toBeInTheDocument();
});

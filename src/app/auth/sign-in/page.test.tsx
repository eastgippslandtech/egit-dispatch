import { render, screen } from "@testing-library/react";

import SignInPage from "./page";

test("renders Zoho-only sign in without local password login", () => {
  render(<SignInPage />);

  expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign in with Zoho" })).toBeInTheDocument();
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/sign up/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/username/i)).not.toBeInTheDocument();
});

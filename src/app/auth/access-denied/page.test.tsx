import { render, screen } from "@testing-library/react";

import { AccessNotApproved } from "../auth-screen";

test("renders friendly access not approved screen", () => {
  render(<AccessNotApproved email="external@example.com" name="External" />);

  expect(
    screen.getByRole("heading", { name: "Access not approved" }),
  ).toBeInTheDocument();
  expect(screen.getByText("External / external@example.com")).toBeInTheDocument();
});

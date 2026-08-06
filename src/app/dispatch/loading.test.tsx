import { render, screen } from "@testing-library/react";

import DispatchLoading from "./loading";

test("shows an immediate Command Centre loading state", () => {
  render(<DispatchLoading />);

  expect(
    screen.getByRole("status", { name: "Loading Command Centre" }),
  ).toBeInTheDocument();
});

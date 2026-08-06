import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { CommandCentreLogo } from "./command-centre-logo";

test("renders the requested Command Centre logo variant accessibly", () => {
  render(<CommandCentreLogo variant="horizontal-dark" />);

  expect(screen.getByRole("img", { name: "Command Centre" })).toHaveAttribute(
    "src",
    "/assets/command-centre/logo-horizontal-dark.svg",
  );
});

test("allows compact logo marks to be decorative", () => {
  render(<CommandCentreLogo variant="icon-colour" decorative />);

  expect(screen.getByRole("presentation")).toHaveAttribute("alt", "");
  expect(screen.getByRole("presentation")).toHaveAttribute(
    "src",
    "/assets/command-centre/icon-full-colour.png",
  );
  expect(screen.queryByRole("img", { name: "Command Centre" })).not.toBeInTheDocument();
});

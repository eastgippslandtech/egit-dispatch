import { createElement } from "react";
import TestRenderer, {
  act,
  type ReactTestRenderer,
} from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import IndexRoute from "../../app/index";

vi.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
}));

describe("IndexRoute", () => {
  it("renders the technician purpose context", () => {
    let rendered: ReactTestRenderer | undefined;
    const testGlobal = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation((message) => {
      if (!String(message).includes("react-test-renderer is deprecated")) {
        throw new Error(`Unexpected render error: ${String(message)}`);
      }
    });

    testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    try {
      act(() => {
        rendered = TestRenderer.create(createElement(IndexRoute));
      });
    } finally {
      consoleError.mockRestore();
    }

    const output = JSON.stringify(rendered?.toJSON());
    expect(output).toContain("Command Centre");
    expect(output).toContain("Technician");
  });
});

import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import { AppButton } from "./app-button";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
}));

describe("AppButton", () => {
  it("centres labels inside the button area", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation((message) => {
      if (!String(message).includes("react-test-renderer is deprecated")) {
        throw new Error(`Unexpected render error: ${String(message)}`);
      }
    });
    const testGlobal = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true;

    let rendered: TestRenderer.ReactTestRenderer | undefined;
    try {
      act(() => {
        rendered = TestRenderer.create(
          createElement(AppButton, {
            accessibilityLabel: "Start timer",
            label: "Start timer",
            onPress: () => undefined,
          }),
        );
      });
    } finally {
      consoleError.mockRestore();
    }

    if (!rendered) {
      throw new Error("AppButton did not render.");
    }

    const button = rendered.root.find((node) => String(node.type) === "Pressable");
    const buttonStyle = flattenStyle(button.props.style({ pressed: false }));
    expect(buttonStyle).toMatchObject({
      alignItems: "center",
      justifyContent: "center",
      minHeight: 48,
    });

    const text = rendered.root.find((node) => String(node.type) === "Text");
    const textStyle = flattenStyle(text.props.style);
    expect(textStyle).toMatchObject({
      lineHeight: 20,
      textAlign: "center",
    });
  });
});

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenStyle));
  }
  if (style && typeof style === "object") {
    return style as Record<string, unknown>;
  }
  return {};
}

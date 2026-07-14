import { Fragment, createElement, type PropsWithChildren } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import { FirstLoginPermissionPrompt } from "./first-login-permission-prompt";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: ({ children }: PropsWithChildren) =>
    createElement(Fragment, null, children),
}));

describe("FirstLoginPermissionPrompt", () => {
  it("waits for user intent before requesting notifications or while-using location", async () => {
    const enableNotifications = vi.fn(async () => "Notifications enabled");
    const enableLocation = vi.fn(async () => "Location enabled while using");
    const rendered = renderPrompt({
      enableLocation,
      enableNotifications,
    });

    expect(enableNotifications).not.toHaveBeenCalled();
    expect(enableLocation).not.toHaveBeenCalled();

    await pressButton(rendered, "Enable notifications");
    await pressButton(rendered, "Allow while using");

    expect(enableNotifications).toHaveBeenCalledTimes(1);
    expect(enableLocation).toHaveBeenCalledTimes(1);
    expect(textValues(rendered)).toEqual(
      expect.arrayContaining([
        "Notifications enabled",
        "Location enabled while using",
      ]),
    );
  });
});

function renderPrompt({
  enableLocation,
  enableNotifications,
}: {
  enableLocation: () => Promise<string>;
  enableNotifications: () => Promise<string>;
}) {
  let rendered: ReactTestRenderer | undefined;
  const consoleError = vi.spyOn(console, "error").mockImplementation((message) => {
    if (!String(message).includes("react-test-renderer is deprecated")) {
      throw new Error(`Unexpected render error: ${String(message)}`);
    }
  });
  const testGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;

  try {
    act(() => {
      rendered = TestRenderer.create(
        <FirstLoginPermissionPrompt
          enableLocation={enableLocation}
          enableNotifications={enableNotifications}
          onDismiss={() => undefined}
        />,
      );
    });
  } finally {
    consoleError.mockRestore();
  }

  if (!rendered) {
    throw new Error("Permission prompt did not render.");
  }
  return rendered;
}

async function pressButton(rendered: ReactTestRenderer, label: string) {
  const button = rendered.root.find(
    (node) =>
      node.props.accessibilityRole === "button" &&
      node.props.accessibilityLabel === label,
  );
  await act(async () => {
    await button.props.onPress();
  });
}

function textValues(rendered: ReactTestRenderer) {
  return rendered.root
    .findAll((node) => String(node.type) === "Text")
    .map((node) => node.children.join(""));
}

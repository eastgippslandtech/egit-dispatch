import {
  Fragment,
  createElement,
  type ComponentType,
  type PropsWithChildren,
} from "react";
import TestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import { RootNavigator } from "./_layout";
import TabsLayout from "./(tabs)/_layout";
import SignInRoute from "./sign-in";
import {
  AppProviders,
  type TechnicianSession,
} from "../src/providers/app-providers";
import { MOBILE_STAFF_FIXTURES } from "../src/testing/fixtures";

const navigationHarness = vi.hoisted(() => ({
  routes: {} as Record<string, ComponentType>,
}));

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StatusBar: "StatusBar",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
}));

vi.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: function MockSafeAreaProvider({
    children,
  }: PropsWithChildren) {
    return createElement(Fragment, null, children);
  },
  SafeAreaView: "SafeAreaView",
}));

vi.mock("expo-router", () => {
  function Stack({ children }: PropsWithChildren) {
    return createElement(Fragment, null, children);
  }

  Stack.Protected = function Protected({
    children,
    guard,
  }: PropsWithChildren<{ guard: boolean }>) {
    return guard ? createElement(Fragment, null, children) : null;
  };
  Stack.Screen = function Screen({ name }: { name: string }) {
    const Route = navigationHarness.routes[name];
    return Route ? createElement(Route) : null;
  };

  function Tabs({ children }: PropsWithChildren) {
    return createElement(Fragment, null, children);
  }

  Tabs.Screen = function Screen({
    options,
  }: {
    options: { tabBarAccessibilityLabel?: string; title: string };
  }) {
    return createElement(
      "Text",
      {
        accessibilityLabel:
          options.tabBarAccessibilityLabel ?? options.title,
        accessibilityRole: "tab",
      },
      options.title,
    );
  };

  return {
    Redirect: () => null,
    Stack,
    Tabs,
  };
});

const riley = MOBILE_STAFF_FIXTURES.find(
  (staff) => staff.email === "riley@egit.com.au",
);

if (!riley) {
  throw new Error("Riley's mobile staff fixture is required by navigation tests.");
}

const approvedRileySession: TechnicianSession = {
  status: "approved",
  staff: riley,
};

navigationHarness.routes["sign-in"] = SignInRoute;
navigationHarness.routes["(tabs)"] = TabsLayout;

function renderTechnicianRouter(session: TechnicianSession) {
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
      rendered = TestRenderer.create(
        <AppProviders initialSession={session}>
          <RootNavigator />
        </AppProviders>,
      );
    });
  } finally {
    consoleError.mockRestore();
  }

  if (!rendered) {
    throw new Error("The technician router did not render.");
  }

  return rendered;
}

function textValues(root: ReactTestInstance) {
  return root
    .findAll((node) => String(node.type) === "Text")
    .map((node) => node.children.join(""));
}

function buttonsNamed(root: ReactTestInstance, name: string) {
  return root.findAll(
    (node) =>
      node.props.accessibilityRole === "button" &&
      node.props.accessibilityLabel === name,
  );
}

describe("technician navigation", () => {
  it("shows the native Zoho sign-in command when signed out", () => {
    const rendered = renderTechnicianRouter({ status: "signed-out" });

    expect(buttonsNamed(rendered.root, "Sign in with Zoho")).toHaveLength(1);
    expect(textValues(rendered.root)).not.toContain("My Work");
  });

  it("shows technician tabs when a mock session is approved", () => {
    const rendered = renderTechnicianRouter(approvedRileySession);
    const labels = textValues(rendered.root);

    expect(labels).toEqual(
      expect.arrayContaining(["Today", "My Work", "Sync", "Profile"]),
    );
    expect(buttonsNamed(rendered.root, "Sign in with Zoho")).toHaveLength(0);
  });
});

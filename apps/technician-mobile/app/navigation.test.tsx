import {
  Fragment,
  createElement,
  useEffect,
  type ComponentType,
  type PropsWithChildren,
  type ReactElement,
} from "react";
import TestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { Pressable } from "react-native";
import { describe, expect, it, vi } from "vitest";

import { RootNavigator } from "./_layout";
import TabsLayout from "./(tabs)/_layout";
import IndexRoute from "./index";
import SignInRoute from "./sign-in";
import { colours } from "../src/theme/tokens";
import {
  AppProviders,
  type TechnicianSession,
  useSession,
  useTechnicianRepository,
} from "../src/providers/app-providers";
import type { TechnicianRepository } from "../src/data/technician-repository";
import { MOBILE_STAFF_FIXTURES } from "../src/testing/fixtures";

const navigationHarness = vi.hoisted(() => ({
  routes: {} as Record<string, ComponentType>,
  tabBarActiveTintColor: "",
  tabBarStyle: {} as Record<string, unknown>,
  tabIcons: [] as ReactElement[],
}));

let latestRepository: TechnicianRepository | undefined;

vi.mock("react-native", () => ({
  Image: "Image",
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

vi.mock("@expo/vector-icons/MaterialCommunityIcons", () => ({
  default: "MaterialCommunityIcons",
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

  function Tabs({
    children,
    screenOptions,
  }: PropsWithChildren<{
    screenOptions?: {
      tabBarActiveTintColor?: string;
      tabBarStyle?: Record<string, unknown>;
    };
  }>) {
    navigationHarness.tabBarActiveTintColor =
      screenOptions?.tabBarActiveTintColor ?? "";
    navigationHarness.tabBarStyle = screenOptions?.tabBarStyle ?? {};
    return createElement(Fragment, null, children);
  }

  Tabs.Screen = function Screen({
    options,
  }: {
    options: {
      tabBarAccessibilityLabel?: string;
      tabBarIcon: (properties: {
        color: string;
        focused: boolean;
        size: number;
      }) => ReactElement;
      title: string;
    };
  }) {
    const icon = options.tabBarIcon({
      color: "#123456",
      focused: false,
      size: 23,
    });
    navigationHarness.tabIcons.push(icon);

    return createElement(
      Fragment,
      null,
      createElement(
        "Text",
        {
          accessibilityLabel:
            options.tabBarAccessibilityLabel ?? options.title,
          accessibilityRole: "tab",
        },
        options.title,
      ),
      icon,
    );
  };

  return {
    Redirect: ({ href }: { href: string }) =>
      createElement(
        "Text",
        { accessibilityLabel: "Redirect target" },
        href,
      ),
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

const matt = MOBILE_STAFF_FIXTURES.find(
  (staff) => staff.email === "mattd@egit.com.au",
);

if (!matt) {
  throw new Error("Matt's mobile staff fixture is required by navigation tests.");
}

navigationHarness.routes.index = IndexRoute;
navigationHarness.routes["sign-in"] = SignInRoute;
navigationHarness.routes["(tabs)"] = TabsLayout;

function ProviderProbe() {
  const repository = useTechnicianRepository();
  const { signOut } = useSession();

  useEffect(() => {
    latestRepository = repository;
  }, [repository]);

  return (
    <Pressable
      accessibilityLabel="Test sign out"
      accessibilityRole="button"
      onPress={signOut}
    />
  );
}

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
  latestRepository = undefined;
  navigationHarness.tabBarStyle = {};
  navigationHarness.tabBarActiveTintColor = "";
  navigationHarness.tabIcons = [];
  try {
    act(() => {
      rendered = TestRenderer.create(
        <AppProviders initialSession={session}>
          <RootNavigator />
          <ProviderProbe />
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

function redirectTarget(root: ReactTestInstance) {
  return root.find(
    (node) => node.props.accessibilityLabel === "Redirect target",
  ).children.join("");
}

function pressButton(rendered: ReactTestRenderer, name: string) {
  const buttons = buttonsNamed(rendered.root, name);
  expect(buttons).toHaveLength(1);
  act(() => {
    buttons[0].props.onPress();
  });
}

describe("technician navigation", () => {
  it("shows the native Zoho sign-in command when signed out", () => {
    const rendered = renderTechnicianRouter({ status: "signed-out" });

    expect(buttonsNamed(rendered.root, "Sign in with Zoho")).toHaveLength(1);
    expect(
      rendered.root.findAll(
        (node) => node.props.accessibilityLabel === "Command Centre brand mark",
      ),
    ).toHaveLength(1);
    expect(textValues(rendered.root)).not.toContain("My Work");
    expect(redirectTarget(rendered.root)).toBe("/sign-in");
  });

  it("shows technician tabs when a mock session is approved", () => {
    const rendered = renderTechnicianRouter(approvedRileySession);
    const labels = textValues(rendered.root);

    expect(labels).toEqual(
      expect.arrayContaining(["Today", "My Work", "Sync", "Profile"]),
    );
    expect(buttonsNamed(rendered.root, "Sign in with Zoho")).toHaveLength(0);
    expect(redirectTarget(rendered.root)).toBe("/(tabs)/today");
  });

  it("moves from the Zoho action into the protected technician tabs", () => {
    const rendered = renderTechnicianRouter({ status: "signed-out" });

    pressButton(rendered, "Sign in with Zoho");

    expect(textValues(rendered.root)).toEqual(
      expect.arrayContaining(["Today", "My Work", "Sync", "Profile"]),
    );
    expect(buttonsNamed(rendered.root, "Sign in with Zoho")).toHaveLength(0);
    expect(redirectTarget(rendered.root)).toBe("/(tabs)/today");
  });

  it("returns to signed-out protection when the session signs out", () => {
    const rendered = renderTechnicianRouter(approvedRileySession);

    pressButton(rendered, "Test sign out");

    expect(buttonsNamed(rendered.root, "Sign in with Zoho")).toHaveLength(1);
    expect(textValues(rendered.root)).not.toContain("My Work");
    expect(redirectTarget(rendered.root)).toBe("/sign-in");
  });

  it("selects Riley's repository after Matt signs out and signs in", async () => {
    const rendered = renderTechnicianRouter({ status: "approved", staff: matt });

    pressButton(rendered, "Test sign out");
    pressButton(rendered, "Sign in with Zoho");

    if (!latestRepository) {
      throw new Error("The repository probe did not receive a repository.");
    }
    const currentStaff = await latestRepository.getCurrentStaff();
    expect(currentStaff.email).toBe("riley@egit.com.au");
  });

  it("leaves native tab sizing to the inset-aware navigator", () => {
    renderTechnicianRouter(approvedRileySession);

    expect(navigationHarness.tabBarStyle).not.toHaveProperty("height");
    expect(navigationHarness.tabBarStyle).not.toHaveProperty("paddingBottom");
  });

  it("uses the Command Centre warm accent for active tabs", () => {
    renderTechnicianRouter(approvedRileySession);

    expect(navigationHarness.tabBarActiveTintColor).toBe(colours.primary);
  });

  it("uses native tab icons with navigator-provided size and colour", () => {
    renderTechnicianRouter(approvedRileySession);

    expect(navigationHarness.tabIcons).toHaveLength(4);
    expect(navigationHarness.tabIcons.map((icon) => icon.type)).toEqual([
      "MaterialCommunityIcons",
      "MaterialCommunityIcons",
      "MaterialCommunityIcons",
      "MaterialCommunityIcons",
    ]);
    for (const icon of navigationHarness.tabIcons) {
      expect(icon.props).toMatchObject({
        accessibilityElementsHidden: true,
        color: "#123456",
        importantForAccessibility: "no-hide-descendants",
        size: 23,
      });
    }
  });
});

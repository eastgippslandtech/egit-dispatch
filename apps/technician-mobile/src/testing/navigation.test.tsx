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
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RootNavigator } from "../../app/_layout";
import TabsLayout from "../../app/(tabs)/_layout";
import IndexRoute from "../../app/index";
import ProfileRoute from "../../app/(tabs)/profile";
import SignInRoute from "../../app/sign-in";
import {
  AppProviders,
  type TechnicianSession,
  type ZohoSignInResult,
  useSession,
  useTechnicianRepository,
} from "../providers/app-providers";
import type { TechnicianRepository } from "../data/technician-repository";
import { colours } from "../theme/tokens";
import { MOBILE_STAFF_FIXTURES } from "./fixtures";

const navigationHarness = vi.hoisted(() => ({
  routes: {} as Record<string, ComponentType>,
  stackOptions: {} as Record<string, Record<string, unknown>>,
  tabBarActiveTintColor: "",
  hiddenTabTitles: [] as string[],
  routerPush: vi.fn(),
  tabBarStyle: {} as Record<string, unknown>,
  tabIcons: [] as ReactElement[],
}));

let latestRepository: TechnicianRepository | undefined;

const sessionStoreMock = vi.hoisted(() => ({
  clearMobileSession: vi.fn(),
  restoreMobileSession: vi.fn(),
  saveMobileSession: vi.fn(),
}));

vi.mock("../auth/session-store", () => sessionStoreMock);

const sessionRefreshMock = vi.hoisted(() => ({
  refreshMobileSession: vi.fn(),
}));

vi.mock("../auth/session-refresh", () => sessionRefreshMock);

const secureStoreMock = vi.hoisted(() => ({
  values: new Map<string, string>(),
  getItemAsync: vi.fn(async (key: string) => secureStoreMock.values.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureStoreMock.values.set(key, value);
  }),
}));

vi.mock("expo-secure-store", () => secureStoreMock);

vi.mock("react-native", () => ({
  Image: "Image",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StatusBar: "StatusBar",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));

vi.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: function MockSafeAreaProvider({
    children,
  }: PropsWithChildren) {
    return createElement(Fragment, null, children);
  },
  SafeAreaView: "SafeAreaView",
  useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 59 }),
}));

vi.mock("@expo/vector-icons/MaterialCommunityIcons", () => ({
  default: "MaterialCommunityIcons",
}));

vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "0.1.0" } },
}));

vi.mock("expo-device", () => ({
  osInternalBuildId: "test-build",
}));

vi.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: vi.fn(),
}));

vi.mock("expo-notifications", () => ({
  getExpoPushTokenAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
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
  Stack.Screen = function Screen({
    name,
    options,
  }: {
    name: string;
    options?: Record<string, unknown>;
  }) {
    navigationHarness.stackOptions[name] = options ?? {};
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
      href?: string | null;
      tabBarAccessibilityLabel?: string;
      tabBarIcon: (properties: {
        color: string;
        focused: boolean;
        size: number;
      }) => ReactElement;
      title: string;
    };
  }) {
    if (options.href === null) {
      navigationHarness.hiddenTabTitles.push(options.title);
      return null;
    }

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
    useRouter: () => ({ push: navigationHarness.routerPush }),
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

const approvedRileyZohoSignIn = async (): Promise<ZohoSignInResult> => ({
  session: {
    accessToken: "access-riley",
    expiresAt: "2030-01-01T00:00:00.000Z",
    refreshToken: "refresh-riley",
    staffEmail: riley.email,
  },
  staff: riley,
});

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

function renderTechnicianRouter(
  session: TechnicianSession,
  signInWithZoho = approvedRileyZohoSignIn,
) {
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
  navigationHarness.stackOptions = {};
  navigationHarness.tabBarStyle = {};
  navigationHarness.tabBarActiveTintColor = "";
  navigationHarness.hiddenTabTitles = [];
  navigationHarness.routerPush.mockReset();
  navigationHarness.tabIcons = [];
  try {
    act(() => {
      rendered = TestRenderer.create(
        <AppProviders
          initialSession={session}
          signInWithZoho={signInWithZoho}
        >
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

function renderProfileSettings(session: TechnicianSession) {
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
  navigationHarness.routerPush.mockReset();
  try {
    act(() => {
      rendered = TestRenderer.create(
        <AppProviders initialSession={session}>
          <ProfileRoute />
        </AppProviders>,
      );
    });
  } finally {
    consoleError.mockRestore();
  }

  if (!rendered) {
    throw new Error("The profile settings screen did not render.");
  }

  return rendered;
}

async function renderProfileSettingsAsync(session: TechnicianSession) {
  const rendered = renderProfileSettings(session);
  await act(async () => {
    await Promise.resolve();
  });
  return rendered;
}

async function renderTechnicianRouterAsync(
  session: TechnicianSession,
  signInWithZoho = approvedRileyZohoSignIn,
) {
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
  navigationHarness.stackOptions = {};
  navigationHarness.tabBarStyle = {};
  navigationHarness.tabBarActiveTintColor = "";
  navigationHarness.hiddenTabTitles = [];
  navigationHarness.routerPush.mockReset();
  navigationHarness.tabIcons = [];
  try {
    await act(async () => {
      rendered = TestRenderer.create(
        <AppProviders
          initialSession={session}
          signInWithZoho={signInWithZoho}
        >
          <RootNavigator />
          <ProviderProbe />
        </AppProviders>,
      );
      await Promise.resolve();
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

function elementsNamed(root: ReactTestInstance, name: string) {
  return root.findAll((node) => node.props.accessibilityLabel === name);
}

function textFieldsNamed(root: ReactTestInstance, name: string) {
  return root.findAll(
    (node) =>
      String(node.type) === "TextInput" &&
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

async function pressButtonAsync(rendered: ReactTestRenderer, name: string) {
  const buttons = buttonsNamed(rendered.root, name);
  expect(buttons).toHaveLength(1);
  await act(async () => {
    await buttons[0].props.onPress();
  });
}

function pressElement(rendered: ReactTestRenderer, name: string) {
  const elements = elementsNamed(rendered.root, name);
  expect(elements).toHaveLength(1);
  act(() => {
    elements[0].props.onPress();
  });
}

function changeText(rendered: ReactTestRenderer, name: string, value: string) {
  const fields = textFieldsNamed(rendered.root, name);
  expect(fields).toHaveLength(1);
  act(() => {
    fields[0].props.onChangeText(value);
  });
}

describe("technician navigation", () => {
  beforeEach(() => {
    vi.useRealTimers();
    sessionStoreMock.clearMobileSession.mockReset();
    sessionStoreMock.restoreMobileSession.mockReset();
    sessionStoreMock.saveMobileSession.mockReset();
    sessionStoreMock.restoreMobileSession.mockResolvedValue(null);
    sessionRefreshMock.refreshMobileSession.mockReset();
    sessionRefreshMock.refreshMobileSession.mockImplementation((session) =>
      Promise.resolve(session),
    );
    secureStoreMock.values.clear();
    secureStoreMock.getItemAsync.mockClear();
    secureStoreMock.setItemAsync.mockClear();
  });

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

  it("unlocks a disclosed reviewer demo session after the brand gesture and review code", () => {
    const rendered = renderTechnicianRouter({ status: "signed-out" });

    for (let taps = 0; taps < 5; taps += 1) {
      pressElement(rendered, "Command Centre brand mark");
    }
    changeText(rendered, "Reviewer demo code", "EGIT-REVIEW-2026");
    pressButton(rendered, "Open reviewer demo");

    expect(textValues(rendered.root)).toEqual(
      expect.arrayContaining(["Today", "My Work", "Profile & Settings"]),
    );
    expect(textValues(rendered.root)).not.toContain("Sync");
    expect(buttonsNamed(rendered.root, "Sign in with Zoho")).toHaveLength(0);
    expect(redirectTarget(rendered.root)).toBe("/(tabs)/today");
  });

  it("keeps reviewer demo access locked when the review code is wrong", () => {
    const rendered = renderTechnicianRouter({ status: "signed-out" });

    for (let taps = 0; taps < 5; taps += 1) {
      pressElement(rendered, "Command Centre brand mark");
    }
    changeText(rendered, "Reviewer demo code", "WRONG-CODE");
    pressButton(rendered, "Open reviewer demo");

    expect(redirectTarget(rendered.root)).toBe("/sign-in");
    expect(textValues(rendered.root)).toContain("Reviewer demo code not recognised.");
  });

  it("shows technician tabs when a mock session is approved", () => {
    const rendered = renderTechnicianRouter(approvedRileySession);
    const labels = textValues(rendered.root);

    expect(labels).toEqual(
      expect.arrayContaining(["Today", "My Work", "Profile & Settings"]),
    );
    expect(labels).not.toContain("Sync");
    expect(buttonsNamed(rendered.root, "Sign in with Zoho")).toHaveLength(0);
    expect(redirectTarget(rendered.root)).toBe("/(tabs)/today");
  });

  it("moves from the Zoho action into the protected technician tabs", async () => {
    const rendered = renderTechnicianRouter({ status: "signed-out" });

    await pressButtonAsync(rendered, "Sign in with Zoho");

    expect(textValues(rendered.root)).toEqual(
      expect.arrayContaining(["Today", "My Work", "Profile & Settings"]),
    );
    expect(textValues(rendered.root)).not.toContain("Sync");
    expect(buttonsNamed(rendered.root, "Sign in with Zoho")).toHaveLength(0);
    expect(redirectTarget(rendered.root)).toBe("/(tabs)/today");
  });

  it("keeps sync available from profile settings without showing it as a bottom tab", () => {
    renderTechnicianRouter(approvedRileySession);

    expect(navigationHarness.hiddenTabTitles).toContain("Sync");

    const profile = renderProfileSettings(approvedRileySession);
    pressButton(profile, "Open sync settings");

    expect(navigationHarness.routerPush).toHaveBeenCalledWith("/(tabs)/sync");
  });

  it("keeps profile settings scrollable with evenly spaced actions", () => {
    const profile = renderProfileSettings(approvedRileySession);

    const scrollContent = profile.root.findByProps({
      testID: "profile-settings-scroll",
    });
    const actionGroup = profile.root.findByProps({
      testID: "profile-settings-actions",
    });

    expect(scrollContent.props.contentInsetAdjustmentBehavior).toBe("automatic");
    expect(scrollContent.props.contentContainerStyle).toMatchObject({
      gap: 20,
      paddingBottom: expect.any(Number),
    });
    expect(actionGroup.props.style).toMatchObject({ gap: 12 });
  });

  it("starts a 30 minute lunch from profile settings", async () => {
    const liveRileySession: TechnicianSession = {
      ...approvedRileySession,
      mobileSession: {
        accessToken: "access-riley",
        expiresAt: "2030-01-01T00:00:00.000Z",
        refreshToken: "refresh-riley",
        staffEmail: riley.email,
      },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            override: {
              endsAt: "2026-07-26T02:30:00.000Z",
              id: "lunch",
              status: "lunch",
            },
          },
          meta: { requestId: "mobile-test", serverTime: "2026-07-26T02:00:00.000Z" },
        }),
        { status: 200 },
      ),
    );

    try {
      const profile = renderProfileSettings(liveRileySession);
      await pressButtonAsync(profile, "Start lunch");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://command.egit.com.au/api/mobile/v1/presence",
        expect.objectContaining({
          body: JSON.stringify({ action: "start_lunch" }),
          method: "POST",
        }),
      );
      expect(textValues(profile.root)).toContain("Lunch started: 30 minutes");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("only allows lunch once per local day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T02:00:00.000Z"));
    const liveRileySession: TechnicianSession = {
      ...approvedRileySession,
      mobileSession: {
        accessToken: "access-riley",
        expiresAt: "2030-01-01T00:00:00.000Z",
        refreshToken: "refresh-riley",
        staffEmail: riley.email,
      },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            override: {
              endsAt: "2026-07-30T02:30:00.000Z",
              id: "lunch",
              status: "lunch",
            },
          },
          meta: { requestId: "mobile-test", serverTime: "2026-07-30T02:00:00.000Z" },
        }),
        { status: 200 },
      ),
    );

    try {
      const profile = await renderProfileSettingsAsync(liveRileySession);
      await pressButtonAsync(profile, "Start lunch");

      expect(buttonsNamed(profile.root, "Start lunch")[0].props.disabled).toBe(true);
      expect(textValues(profile.root)).toContain("Lunch started: 30 minutes");

      const sameDayProfile = await renderProfileSettingsAsync(liveRileySession);
      expect(
        buttonsNamed(sameDayProfile.root, "Start lunch")[0].props.disabled,
      ).toBe(true);
      expect(textValues(sameDayProfile.root)).toContain("Lunch already taken today");

      vi.setSystemTime(new Date("2026-07-31T02:00:00.000Z"));
      const nextDayProfile = await renderProfileSettingsAsync(liveRileySession);
      expect(
        buttonsNamed(nextDayProfile.root, "Start lunch")[0].props.disabled,
      ).toBe(false);
    } finally {
      fetchMock.mockRestore();
      vi.useRealTimers();
    }
  });

  it("restores the saved mobile session without asking for Zoho again", async () => {
    const restoredSession = {
      accessToken: "access-riley",
      expiresAt: "2030-01-01T00:00:00.000Z",
      refreshToken: "refresh-riley",
      staffEmail: riley.email,
    };
    sessionStoreMock.restoreMobileSession.mockResolvedValue(restoredSession);
    sessionRefreshMock.refreshMobileSession.mockResolvedValue(restoredSession);
    const signInWithZoho = vi.fn(approvedRileyZohoSignIn);

    const rendered = await renderTechnicianRouterAsync(
      { status: "signed-out" },
      signInWithZoho,
    );

    expect(signInWithZoho).not.toHaveBeenCalled();
    expect(buttonsNamed(rendered.root, "Sign in with Zoho")).toHaveLength(0);
    expect(redirectTarget(rendered.root)).toBe("/(tabs)/today");
  });

  it("refreshes an expired saved mobile session without asking for Zoho again", async () => {
    const restoredSession = {
      accessToken: "old-access-riley",
      expiresAt: "2026-07-12T05:00:00.000Z",
      refreshToken: "refresh-riley",
      staffEmail: riley.email,
    };
    const refreshedSession = {
      accessToken: "new-access-riley",
      expiresAt: "2026-07-12T06:00:00.000Z",
      refreshToken: "new-refresh-riley",
      staffEmail: riley.email,
    };
    sessionStoreMock.restoreMobileSession.mockResolvedValue(restoredSession);
    sessionRefreshMock.refreshMobileSession.mockResolvedValue(refreshedSession);
    const signInWithZoho = vi.fn(approvedRileyZohoSignIn);

    const rendered = await renderTechnicianRouterAsync(
      { status: "signed-out" },
      signInWithZoho,
    );

    expect(signInWithZoho).not.toHaveBeenCalled();
    expect(sessionRefreshMock.refreshMobileSession).toHaveBeenCalledWith(
      restoredSession,
    );
    expect(sessionStoreMock.saveMobileSession).toHaveBeenCalledWith(
      refreshedSession,
    );
    expect(buttonsNamed(rendered.root, "Sign in with Zoho")).toHaveLength(0);
    expect(redirectTarget(rendered.root)).toBe("/(tabs)/today");
  });

  it("clears a saved mobile session when the refresh token has expired", async () => {
    sessionStoreMock.restoreMobileSession.mockResolvedValue({
      accessToken: "old-access-riley",
      expiresAt: "2026-07-12T05:00:00.000Z",
      refreshToken: "expired-refresh-riley",
      staffEmail: riley.email,
    });
    sessionRefreshMock.refreshMobileSession.mockResolvedValue(null);
    const signInWithZoho = vi.fn(approvedRileyZohoSignIn);

    const rendered = await renderTechnicianRouterAsync(
      { status: "signed-out" },
      signInWithZoho,
    );

    expect(signInWithZoho).not.toHaveBeenCalled();
    expect(sessionStoreMock.clearMobileSession).toHaveBeenCalledTimes(1);
    expect(buttonsNamed(rendered.root, "Sign in with Zoho")).toHaveLength(1);
    expect(redirectTarget(rendered.root)).toBe("/sign-in");
  });

  it("returns to signed-out protection when the session signs out", () => {
    const rendered = renderTechnicianRouter(approvedRileySession);

    pressButton(rendered, "Test sign out");

    expect(sessionStoreMock.clearMobileSession).toHaveBeenCalledTimes(1);
    expect(buttonsNamed(rendered.root, "Sign in with Zoho")).toHaveLength(1);
    expect(textValues(rendered.root)).not.toContain("My Work");
    expect(redirectTarget(rendered.root)).toBe("/sign-in");
  });

  it("uses the Zoho-approved staff after sign-in instead of defaulting to Riley", async () => {
    const rendered = renderTechnicianRouter(
      { status: "approved", staff: riley },
      async () => ({
        session: {
          accessToken: "access-matt",
          expiresAt: "2030-01-01T00:00:00.000Z",
          refreshToken: "refresh-matt",
          staffEmail: matt.email,
        },
        staff: matt,
      }),
    );

    pressButton(rendered, "Test sign out");
    await pressButtonAsync(rendered, "Sign in with Zoho");

    if (!latestRepository) {
      throw new Error("The repository probe did not receive a repository.");
    }
    const currentStaff = await latestRepository.getCurrentStaff();
    expect(currentStaff.email).toBe("mattd@egit.com.au");
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

    expect(navigationHarness.tabIcons).toHaveLength(3);
    expect(navigationHarness.tabIcons.map((icon) => icon.type)).toEqual([
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

  it("uses a human job-detail back label instead of exposing the tabs route group", () => {
    renderTechnicianRouter(approvedRileySession);

    expect(navigationHarness.stackOptions["job/[jobId]"]).toMatchObject({
      headerBackTitle: "Jobs",
      title: "Job",
    });
  });
});

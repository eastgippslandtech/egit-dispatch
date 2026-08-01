import * as Notifications from "expo-notifications";
import { Stack } from "expo-router";
import { type PropsWithChildren, useEffect, useRef } from "react";
import { StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  AppProviders,
  useSession,
  useTechnicianRepository,
} from "../src/providers/app-providers";
import {
  ActiveTimerProvider,
  GlobalTimerBanner,
} from "../src/features/timer/active-timer-provider";
import { enableWhileUsingLocation as requestWhileUsingLocation } from "../src/features/location/foreground-location";
import { FirstLoginPermissionGate } from "../src/features/onboarding/first-login-permission-prompt";
import { registerCurrentDeviceNotifications } from "../src/features/notifications/register-current-device";
import { colours } from "../src/theme/tokens";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function RootNavigator() {
  const { session } = useSession();
  const isApproved = session.status === "approved";
  const registeredSession = useRef<string | null>(null);

  useEffect(() => {
    if (session.status !== "approved" || !session.mobileSession) {
      registeredSession.current = null;
      return;
    }

    const sessionKey = `${session.staff.email}:${session.mobileSession.accessToken}`;
    if (registeredSession.current === sessionKey) {
      return;
    }
    registeredSession.current = sessionKey;
    void registerCurrentDeviceNotifications({
      mode: "automatic",
      mobileSession: session.mobileSession,
    }).catch(() => {
      // Registration can be retried from Profile without blocking app startup.
    });
  }, [session]);

  return (
    <View style={styles.shell}>
      <StatusBar
        backgroundColor={colours.canvas}
        barStyle="light-content"
      />
      {isApproved ? <GlobalTimerBanner /> : null}
      <FirstLoginPermissionGate
        enableLocation={enableWhileUsingLocation}
        enableNotifications={() => enableJobNotifications(session)}
        enabled={isApproved}
      >
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: colours.canvas },
            headerStyle: { backgroundColor: colours.surface },
            headerTintColor: colours.text,
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Protected guard={!isApproved}>
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={isApproved}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="job/[jobId]"
              options={{ headerBackTitle: "Jobs", title: "Job" }}
            />
          </Stack.Protected>
        </Stack>
      </FirstLoginPermissionGate>
    </View>
  );
}

async function enableJobNotifications(
  session: ReturnType<typeof useSession>["session"],
): Promise<string> {
  const mobileSession =
    session.status === "approved" ? session.mobileSession : undefined;
  if (!mobileSession) {
    return "Sign in with Zoho to enable notifications";
  }

  const result = await registerCurrentDeviceNotifications({
    mode: "manual",
    mobileSession,
  });

  return result.status === "registered"
    ? `Notifications enabled (${result.tokenPreview})`
    : result.status === "not-device"
      ? "Use a physical phone to enable notifications"
      : "Notification permission not granted";
}

async function enableWhileUsingLocation(): Promise<string> {
  const location = await import("expo-location");
  return requestWhileUsingLocation(location);
}

function ActiveTimerProviderBridge({ children }: PropsWithChildren) {
  const repository = useTechnicianRepository();
  return (
    <ActiveTimerProvider repository={repository}>
      {children}
    </ActiveTimerProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProviders>
        <ActiveTimerProviderBridge>
          <RootNavigator />
        </ActiveTimerProviderBridge>
      </AppProviders>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colours.canvas,
    flex: 1,
  },
});

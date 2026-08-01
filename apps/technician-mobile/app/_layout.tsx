import * as Notifications from "expo-notifications";
import { Stack } from "expo-router";
import { useEffect, useRef } from "react";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  AppProviders,
  useSession,
} from "../src/providers/app-providers";
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
    <>
      <StatusBar
        backgroundColor={colours.canvas}
        barStyle="light-content"
      />
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
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProviders>
        <RootNavigator />
      </AppProviders>
    </SafeAreaProvider>
  );
}

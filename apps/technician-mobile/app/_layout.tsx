import { Stack } from "expo-router";
import { type PropsWithChildren } from "react";
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
import { createApiClient } from "../src/api/client";
import { getMobileRuntimeConfig } from "../src/config/runtime";
import { FirstLoginPermissionGate } from "../src/features/onboarding/first-login-permission-prompt";
import { createPushRegistration } from "../src/features/notifications/register-device";
import { colours } from "../src/theme/tokens";

export function RootNavigator() {
  const { session } = useSession();
  const isApproved = session.status === "approved";

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
  const [
    constantsModule,
    deviceModule,
    notificationsModule,
    reactNativeModule,
  ] = await Promise.all([
    import("expo-constants"),
    import("expo-device"),
    import("expo-notifications"),
    import("react-native"),
  ]);
  const mobileSession =
    session.status === "approved" ? session.mobileSession : undefined;
  const config = getMobileRuntimeConfig();
  const registration = createPushRegistration({
    notifications: notificationsModule,
    registerToken:
      mobileSession
        ? (payload) =>
            createApiClient({
              accessToken: mobileSession.accessToken,
              baseUrl: config.mobileApiBaseUrl,
            }).request("/devices/push-token", {
              body: payload,
              method: "PUT",
            })
        : undefined,
  });
  const platform =
    reactNativeModule.Platform.OS === "android"
      ? "android"
      : reactNativeModule.Platform.OS === "web"
        ? "web"
        : "ios";
  const result = await registration.enableJobNotifications({
    appVersion: constantsModule.default.expoConfig?.version ?? "0.1.0",
    installationId: `${
      deviceModule.osInternalBuildId ?? "simulator"
    }-${reactNativeModule.Platform.OS}`,
    platform,
  });

  return result.status === "registered"
    ? `Notifications enabled (${result.tokenPreview})`
    : "Notification permission not granted";
}

async function enableWhileUsingLocation(): Promise<string> {
  const location = await import("expo-location");
  const permission = await location.requestForegroundPermissionsAsync();
  return permission.status === "granted"
    ? "Location enabled while using"
    : "Location permission not granted";
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

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
    </View>
  );
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

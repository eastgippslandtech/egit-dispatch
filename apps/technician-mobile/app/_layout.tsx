import { Stack } from "expo-router";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  AppProviders,
  useSession,
} from "../src/providers/app-providers";
import { colours } from "../src/theme/tokens";

export function RootNavigator() {
  const { session } = useSession();
  const isApproved = session.status === "approved";

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

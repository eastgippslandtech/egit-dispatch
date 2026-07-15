import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "../../src/components/app-button";
import { enableWhileUsingLocation } from "../../src/features/location/foreground-location";
import { createPushRegistration } from "../../src/features/notifications/register-device";
import { createApiClient } from "../../src/api/client";
import { getMobileRuntimeConfig } from "../../src/config/runtime";
import { useSession } from "../../src/providers/app-providers";
import { colours } from "../../src/theme/tokens";

export default function ProfileRoute() {
  const { session, signOut } = useSession();
  const [locationStatus, setLocationStatus] = useState("Not enabled");
  const [notificationStatus, setNotificationStatus] = useState("Not enabled");
  const staff =
    session.status === "approved"
      ? session.staff
      : {
          baseOffice: "Bairnsdale",
          displayName: "Riley",
          email: "riley@egit.com.au",
          role: "technician",
        };
  const mobileSession =
    session.status === "approved" ? session.mobileSession : undefined;

  const enableNotifications = async () => {
    const config = getMobileRuntimeConfig();
    const registration = createPushRegistration({
      notifications: Notifications,
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
    const result = await registration.enableJobNotifications({
      appVersion: Constants.expoConfig?.version ?? "0.1.0",
      installationId: `${Device.osInternalBuildId ?? "simulator"}-${
        Platform.OS
      }`,
      platform: Platform.OS === "android" ? "android" : Platform.OS === "web" ? "web" : "ios",
    });
    setNotificationStatus(
      result.status === "registered"
        ? `Enabled (${result.tokenPreview})`
        : "Permission not granted",
    );
  };
  const enableLocation = async () => {
    setLocationStatus(await enableWhileUsingLocation(Location));
  };

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
      <Text style={styles.eyebrow}>Profile & settings</Text>
      <Text style={styles.title}>Profile & Settings</Text>
      <Text style={styles.copy}>
        {staff.displayName} · {staff.email}
      </Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Account</Text>
        <Text style={styles.label}>Role</Text>
        <Text style={styles.value}>{staff.role}</Text>
        <Text style={styles.label}>Base office</Text>
        <Text style={styles.value}>{staff.baseOffice}</Text>
        <Text style={styles.sectionTitle}>Settings</Text>
        <Text style={styles.label}>App version</Text>
        <Text style={styles.value}>{Constants.expoConfig?.version ?? "0.1.0"}</Text>
        <Text style={styles.label}>Notifications</Text>
        <Text style={styles.value}>{notificationStatus}</Text>
        <Text style={styles.label}>Location</Text>
        <Text style={styles.value}>{locationStatus}</Text>
      </View>

      <AppButton
        label="Enable job notifications"
        onPress={() => {
          void enableNotifications();
        }}
      />

      <View style={styles.buttonGap}>
        <AppButton
          accessibilityLabel="Enable location while using"
          label="Enable location while using"
          onPress={() => {
            void enableLocation();
          }}
          variant="secondary"
        />
      </View>

      <View style={styles.buttonGap}>
        <AppButton label="Sign out" onPress={signOut} variant="secondary" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colours.surface,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
    marginTop: 24,
    padding: 18,
  },
  copy: { color: colours.muted, fontSize: 16, marginTop: 4 },
  eyebrow: {
    color: colours.primary,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  label: { color: colours.muted, fontSize: 12, fontWeight: "800", marginTop: 8 },
  sectionTitle: {
    color: colours.primary,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.6,
    marginTop: 10,
    textTransform: "uppercase",
  },
  buttonGap: {
    marginTop: 20,
  },
  screen: { backgroundColor: colours.canvas, flex: 1, padding: 20 },
  title: { color: colours.text, fontSize: 34, fontWeight: "900", marginTop: 8 },
  value: { color: colours.text, fontSize: 17, fontWeight: "800" },
});

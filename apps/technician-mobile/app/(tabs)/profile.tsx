import Constants from "expo-constants";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  AppState,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "../../src/components/app-button";
import {
  enableWhileUsingLocation,
  getWhileUsingLocationStatus,
} from "../../src/features/location/foreground-location";
import { createApiClient, MobileApiError } from "../../src/api/client";
import { getMobileRuntimeConfig } from "../../src/config/runtime";
import {
  hasUsedLunchToday,
  markLunchUsedToday,
} from "../../src/features/lunch/lunch-usage";
import { registerCurrentDeviceNotifications } from "../../src/features/notifications/register-current-device";
import { getJobNotificationPermissionStatus } from "../../src/features/notifications/register-device";
import { useSession } from "../../src/providers/app-providers";
import { colours } from "../../src/theme/tokens";

export default function ProfileRoute() {
  const router = useRouter();
  const { refreshAccessToken, session, signOut } = useSession();
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
  const [lunchStatus, setLunchStatus] = useState(
    mobileSession ? "Ready" : "Sign in with Zoho to start lunch.",
  );
  const [lunchBusy, setLunchBusy] = useState(false);
  const [lunchTakenToday, setLunchTakenToday] = useState(false);

  const refreshPermissionStatuses = useCallback(async () => {
    const [notificationPermission, locationPermission] = await Promise.all([
      getJobNotificationPermissionStatus(Notifications),
      getWhileUsingLocationStatus(Location),
    ]);

    setNotificationStatus(
      notificationPermission === "enabled"
        ? "Enabled on this phone"
        : notificationPermission === "settings-required"
          ? "Open phone settings to enable notifications"
          : "Not enabled",
    );
    setLocationStatus(
      locationPermission === "enabled"
        ? "Enabled while using"
        : locationPermission === "settings-required"
          ? "Open phone settings to enable location while using"
          : "Not enabled",
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        await refreshPermissionStatuses();
      } catch {
        if (!cancelled) {
          setNotificationStatus("Unable to check notification permission");
          setLocationStatus("Unable to check location permission");
        }
      }
    };

    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refresh();
      }
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [refreshPermissionStatuses]);

  useEffect(() => {
    let cancelled = false;

    if (!mobileSession) return;

    void hasUsedLunchToday(staff.email).then((usedToday) => {
      if (cancelled) return;
      setLunchTakenToday((current) => {
        if (current) return current;
        if (usedToday) {
          setLunchStatus("Lunch already taken today");
        }
        return usedToday;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [mobileSession, staff.email]);

  const enableNotifications = async () => {
    if (!mobileSession) {
      setNotificationStatus("Sign in with Zoho to enable notifications");
      return;
    }

    const result = await registerCurrentDeviceNotifications({
      mode: "manual",
      mobileSession,
    });
    setNotificationStatus(
      result.status === "registered"
        ? `Enabled (${result.tokenPreview})`
        : result.status === "settings-required"
          ? "Open phone settings to enable notifications"
        : result.status === "not-device"
          ? "Use a physical phone to enable notifications"
          : "Permission not granted. Enable it in phone settings.",
    );
    await refreshPermissionStatuses();
  };
  const enableLocation = async () => {
    setLocationStatus(
      await enableWhileUsingLocation(Location, {
        openSettings: () => Linking.openSettings(),
      }),
    );
    await refreshPermissionStatuses();
  };
  const startLunch = async () => {
    if (!mobileSession) {
      setLunchStatus("Sign in with Zoho to start lunch.");
      return;
    }

    setLunchBusy(true);
    try {
      const config = getMobileRuntimeConfig();
      await createApiClient({
        accessToken: mobileSession.accessToken,
        baseUrl: config.mobileApiBaseUrl,
        refreshAccessToken,
      }).request("/presence", {
        body: { action: "start_lunch" },
        method: "POST",
      });
      await markLunchUsedToday(staff.email);
      setLunchTakenToday(true);
      setLunchStatus("Lunch started: 30 minutes");
    } catch (error) {
      setLunchStatus(
        error instanceof MobileApiError
          ? `Lunch could not be started (${error.status}). Please try again.`
          : "Lunch could not be started. Please try again.",
      );
    } finally {
      setLunchBusy(false);
    }
  };

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
      <ScrollView
        accessibilityLabel="Profile settings content"
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        testID="profile-settings-scroll"
      >
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Profile & settings</Text>
          <Text style={styles.title}>Profile & Settings</Text>
          <Text style={styles.copy}>
            {staff.displayName} · {staff.email}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Account</Text>
          <Text style={styles.label}>Role</Text>
          <Text style={styles.value}>{staff.role}</Text>
          <Text style={styles.label}>Base office</Text>
          <Text style={styles.value}>{staff.baseOffice}</Text>
          <Text style={styles.sectionTitle}>Settings</Text>
          <Text style={styles.label}>App version</Text>
          <Text style={styles.value}>{Constants.expoConfig?.version ?? "0.1.2"}</Text>
          <Text style={styles.label}>Notifications</Text>
          <Text style={styles.value}>{notificationStatus}</Text>
          <Text style={styles.label}>Location</Text>
          <Text style={styles.value}>{locationStatus}</Text>
          <Text style={styles.sectionTitle}>Availability</Text>
          <Text style={styles.label}>Lunch</Text>
          <Text style={styles.value}>{lunchStatus}</Text>
        </View>

        <View style={styles.actions} testID="profile-settings-actions">
          <AppButton
            disabled={!mobileSession || lunchBusy || lunchTakenToday}
            label={lunchBusy ? "Starting lunch…" : "Start lunch"}
            onPress={startLunch}
          />

          <AppButton
            accessibilityLabel="Open sync settings"
            label="Sync & offline queue"
            onPress={() => {
              router.push("/(tabs)/sync");
            }}
            variant="secondary"
          />

          <AppButton
            label="Enable job notifications"
            onPress={() => {
              void enableNotifications();
            }}
          />

          <AppButton
            accessibilityLabel="Enable location while using"
            label="Enable location while using"
            onPress={() => {
              void enableLocation();
            }}
            variant="secondary"
          />

          <AppButton label="Sign out" onPress={signOut} variant="secondary" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 12,
  },
  card: {
    backgroundColor: colours.surface,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
    padding: 18,
  },
  content: {
    gap: 20,
    padding: 20,
    paddingBottom: 44,
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
  header: {
    gap: 4,
  },
  screen: { backgroundColor: colours.canvas, flex: 1 },
  title: { color: colours.text, fontSize: 34, fontWeight: "900", marginTop: 8 },
  value: { color: colours.text, fontSize: 17, fontWeight: "800" },
});

import Constants from "expo-constants";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { registerCurrentDeviceNotifications } from "../../src/features/notifications/register-current-device";
import { useSession } from "../../src/providers/app-providers";
import { colours } from "../../src/theme/tokens";

export default function ProfileRoute() {
  const { session, signOut } = useSession();
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
        : result.status === "not-device"
          ? "Use a physical phone to enable notifications"
          : "Permission not granted. Enable it in phone settings.",
    );
  };

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
      <Text style={styles.eyebrow}>Technician profile</Text>
      <Text style={styles.title}>{staff.displayName}</Text>
      <Text style={styles.copy}>{staff.email}</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Role</Text>
        <Text style={styles.value}>{staff.role}</Text>
        <Text style={styles.label}>Base office</Text>
        <Text style={styles.value}>{staff.baseOffice}</Text>
        <Text style={styles.label}>App version</Text>
        <Text style={styles.value}>{Constants.expoConfig?.version ?? "0.1.0"}</Text>
        <Text style={styles.label}>Notifications</Text>
        <Text style={styles.value}>{notificationStatus}</Text>
      </View>

      <Pressable onPress={enableNotifications} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>Enable job notifications</Text>
      </Pressable>

      <Pressable onPress={signOut} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>Sign out</Text>
      </Pressable>
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
  primaryButton: {
    alignItems: "center",
    backgroundColor: colours.primary,
    borderRadius: 18,
    marginTop: 20,
    padding: 16,
  },
  primaryButtonText: { color: "#111827", fontSize: 16, fontWeight: "900" },
  screen: { backgroundColor: colours.canvas, flex: 1, padding: 20 },
  secondaryButton: {
    alignItems: "center",
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 12,
    padding: 16,
  },
  secondaryButtonText: { color: colours.text, fontSize: 16, fontWeight: "800" },
  title: { color: colours.text, fontSize: 34, fontWeight: "900", marginTop: 8 },
  value: { color: colours.text, fontSize: 17, fontWeight: "800" },
});

import { useEffect, useState, type PropsWithChildren } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppButton } from "../../components/app-button";
import { colours } from "../../theme/tokens";

export function FirstLoginPermissionPrompt({
  enableLocation,
  enableNotifications,
  onDismiss,
}: {
  enableLocation: () => Promise<string>;
  enableNotifications: () => Promise<string>;
  onDismiss: () => void;
}) {
  const [locationStatus, setLocationStatus] = useState<string | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<string | null>(
    null,
  );

  return (
    <View
      accessibilityLabel="First login permissions"
      style={styles.container}
    >
      <View style={styles.copyGroup}>
        <Text style={styles.eyebrow}>Recommended setup</Text>
        <Text style={styles.title}>Enable field updates</Text>
        <Text style={styles.copy}>
          Turn on job notifications and allow location while using the app for
          ETA and navigation helpers. Command Centre does not track location in
          the background.
        </Text>
      </View>
      <View style={styles.actions}>
        <AppButton
          accessibilityLabel="Enable notifications"
          label="Enable notifications"
          onPress={() => {
            void enableNotifications()
              .then(setNotificationStatus)
              .catch(() =>
                setNotificationStatus("Notifications could not be enabled"),
              );
          }}
        />
        <AppButton
          accessibilityLabel="Allow while using"
          label="Allow while using"
          onPress={() => {
            void enableLocation()
              .then(setLocationStatus)
              .catch(() => setLocationStatus("Location could not be enabled"));
          }}
          variant="secondary"
        />
        <AppButton
          accessibilityLabel="Not now"
          label="Not now"
          onPress={onDismiss}
          variant="secondary"
        />
      </View>
      {notificationStatus ? (
        <Text style={styles.status}>{notificationStatus}</Text>
      ) : null}
      {locationStatus ? <Text style={styles.status}>{locationStatus}</Text> : null}
    </View>
  );
}

const FIRST_LOGIN_PERMISSION_KEY =
  "command-centre.first-login-permissions.v1";

export function FirstLoginPermissionGate({
  children,
  enableLocation,
  enableNotifications,
  enabled,
}: PropsWithChildren<{
  enableLocation: () => Promise<string>;
  enableNotifications: () => Promise<string>;
  enabled: boolean;
}>) {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      return () => {
        cancelled = true;
      };
    }
    void hasSeenFirstLoginPermissions().then((hasSeen) => {
      if (!cancelled) {
        setShowPrompt(!hasSeen);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const dismiss = () => {
    setShowPrompt(false);
    void markFirstLoginPermissionsSeen();
  };

  return (
    <>
      {enabled && showPrompt ? (
        <FirstLoginPermissionPrompt
          enableLocation={enableLocation}
          enableNotifications={enableNotifications}
          onDismiss={dismiss}
        />
      ) : null}
      {children}
    </>
  );
}

async function hasSeenFirstLoginPermissions(): Promise<boolean> {
  const secureStore = await loadSecureStore();
  return Boolean(await secureStore?.getItemAsync(FIRST_LOGIN_PERMISSION_KEY));
}

async function markFirstLoginPermissionsSeen(): Promise<void> {
  const secureStore = await loadSecureStore();
  await secureStore?.setItemAsync(FIRST_LOGIN_PERMISSION_KEY, "seen");
}

async function loadSecureStore(): Promise<
  | {
      getItemAsync(key: string): Promise<string | null>;
      setItemAsync(key: string, value: string): Promise<void>;
    }
  | null
> {
  try {
    return await import("expo-secure-store");
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  actions: {
    gap: 8,
  },
  container: {
    backgroundColor: colours.surface,
    borderBottomColor: colours.borderWarm,
    borderBottomWidth: 1,
    gap: 12,
    padding: 16,
  },
  copy: {
    color: colours.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  copyGroup: {
    gap: 5,
  },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  status: {
    color: colours.text,
    fontSize: 13,
    fontWeight: "800",
  },
  title: {
    color: colours.text,
    fontSize: 18,
    fontWeight: "900",
  },
});

import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { createApiClient } from "../../api/client";
import type { MobileSession } from "../../auth/session-store";
import { getMobileRuntimeConfig } from "../../config/runtime";
import { getOrCreateNotificationInstallationId } from "./installation-id";
import { createPushRegistration } from "./register-device";

type RegistrationMode = "automatic" | "manual";

export async function registerCurrentDeviceNotifications({
  mobileSession,
  mode,
}: {
  mobileSession: MobileSession;
  mode: RegistrationMode;
}) {
  if (!Device.isDevice || Platform.OS === "web") {
    return { status: "not-device" as const };
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("job-updates", {
      importance: Notifications.AndroidImportance.HIGH,
      name: "Job updates",
      sound: "default",
    });
  }

  const config = getMobileRuntimeConfig();
  const api = createApiClient({
    accessToken: mobileSession.accessToken,
    baseUrl: config.mobileApiBaseUrl,
  });
  const registration = createPushRegistration({
    notifications: Notifications,
    registerToken: (payload) =>
      api.request("/devices/push-token", {
        body: payload,
        method: "PUT",
      }),
  });
  const platform = Platform.OS === "android" ? "android" : "ios";
  const installationId = await getOrCreateNotificationInstallationId({
    store: SecureStore,
  });
  const input = {
    appVersion: Constants.expoConfig?.version ?? "0.1.1",
    installationId,
    platform,
    projectId:
      Constants.easConfig?.projectId ??
      (Constants.expoConfig?.extra?.eas?.projectId as string | undefined),
  } as const;

  return mode === "automatic"
    ? registration.ensureJobNotifications(input)
    : registration.enableJobNotifications(input);
}

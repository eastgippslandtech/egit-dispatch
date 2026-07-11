export interface NotificationPermissionResult {
  status: "granted" | "denied" | "undetermined";
}

export interface ExpoPushTokenResult {
  data: string;
}

export interface PushRegistrationNotifications {
  getExpoPushTokenAsync(): Promise<ExpoPushTokenResult>;
  requestPermissionsAsync(): Promise<NotificationPermissionResult>;
}

export interface EnableJobNotificationsInput {
  appVersion: string;
  installationId: string;
  platform: "android" | "ios" | "web";
}

export interface PushDeviceRegistration {
  appVersion: string;
  installationId: string;
  platform: "android" | "ios" | "web";
  pushToken: string;
}

export function createPushRegistration({
  notifications,
  registerToken,
}: {
  notifications: PushRegistrationNotifications;
  registerToken?: (registration: PushDeviceRegistration) => Promise<void>;
}) {
  return {
    async enableJobNotifications(input: EnableJobNotificationsInput) {
      const permission = await notifications.requestPermissionsAsync();
      if (permission.status !== "granted") {
        return { status: "not-granted" as const };
      }

      const token = await notifications.getExpoPushTokenAsync();
      const registration: PushDeviceRegistration = {
        ...input,
        pushToken: token.data,
      };

      await registerToken?.(registration);

      return {
        status: "registered" as const,
        tokenPreview: redactPushToken(token.data),
      };
    },
  };
}

export function redactPushToken(token: string): string {
  if (token.length <= 10) {
    return "••••";
  }
  return `${token.slice(0, 8)}…${token.slice(-6)}`;
}

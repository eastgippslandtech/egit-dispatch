export interface NotificationPermissionResult {
  status: "granted" | "denied" | "undetermined";
}

export interface ExpoPushTokenResult {
  data: string;
}

export interface PushRegistrationNotifications {
  getExpoPushTokenAsync(options?: { projectId?: string }): Promise<ExpoPushTokenResult>;
  getPermissionsAsync(): Promise<NotificationPermissionResult>;
  requestPermissionsAsync(): Promise<NotificationPermissionResult>;
}

export interface EnableJobNotificationsInput {
  appVersion: string;
  installationId: string;
  platform: "android" | "ios" | "web";
  projectId?: string;
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
  const registerApprovedDevice = async (input: EnableJobNotificationsInput) => {
    const token = await notifications.getExpoPushTokenAsync(
      input.projectId ? { projectId: input.projectId } : undefined,
    );
    const registration: PushDeviceRegistration = {
      appVersion: input.appVersion,
      installationId: input.installationId,
      platform: input.platform,
      pushToken: token.data,
    };

    await registerToken?.(registration);

    return {
      status: "registered" as const,
      tokenPreview: redactPushToken(token.data),
    };
  };

  return {
    async ensureJobNotifications(input: EnableJobNotificationsInput) {
      let permission = await notifications.getPermissionsAsync();
      if (permission.status === "undetermined") {
        permission = await notifications.requestPermissionsAsync();
      }
      if (permission.status !== "granted") {
        return { status: "not-granted" as const };
      }

      return registerApprovedDevice(input);
    },

    async enableJobNotifications(input: EnableJobNotificationsInput) {
      const permission = await notifications.requestPermissionsAsync();
      if (permission.status !== "granted") {
        return { status: "not-granted" as const };
      }

      return registerApprovedDevice(input);
    },
  };
}

export function redactPushToken(token: string): string {
  if (token.length <= 10) {
    return "••••";
  }
  return `${token.slice(0, 8)}…${token.slice(-6)}`;
}

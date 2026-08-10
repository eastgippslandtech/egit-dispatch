export interface NotificationPermissionResult {
  canAskAgain?: boolean;
  granted?: boolean;
  status: "granted" | "denied" | "undetermined";
}

export interface ExpoPushTokenResult {
  data: string;
}

export interface PushRegistrationNotifications {
  getExpoPushTokenAsync(options?: { projectId?: string }): Promise<ExpoPushTokenResult>;
  getPermissionsAsync(): Promise<NotificationPermissionResult>;
  requestPermissionsAsync(options?: {
    android?: object;
    ios?: {
      allowAlert?: boolean;
      allowBadge?: boolean;
      allowSound?: boolean;
    };
  }): Promise<NotificationPermissionResult>;
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

export type JobNotificationPermissionStatus =
  | "enabled"
  | "not-enabled"
  | "settings-required";

export async function getJobNotificationPermissionStatus(
  notifications: Pick<PushRegistrationNotifications, "getPermissionsAsync">,
): Promise<JobNotificationPermissionStatus> {
  const permission = await notifications.getPermissionsAsync();
  if (isGranted(permission)) {
    return "enabled";
  }
  if (cannotAskAgain(permission)) {
    return "settings-required";
  }
  return "not-enabled";
}

export function createPushRegistration({
  notifications,
  openSettings,
  registerToken,
}: {
  notifications: PushRegistrationNotifications;
  openSettings?: () => Promise<void>;
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
    async registerExistingJobNotifications(input: EnableJobNotificationsInput) {
      const permission = await notifications.getPermissionsAsync();
      if (cannotAskAgain(permission)) {
        return { status: "settings-required" as const };
      }
      if (!isGranted(permission)) {
        return { status: "not-granted" as const };
      }

      return registerApprovedDevice(input);
    },

    async ensureJobNotifications(input: EnableJobNotificationsInput) {
      let permission = await notifications.getPermissionsAsync();
      if (permission.status === "undetermined") {
        permission = await requestNotificationPermission(notifications);
      } else if (cannotAskAgain(permission)) {
        return { status: "settings-required" as const };
      }
      if (!isGranted(permission)) {
        return { status: "not-granted" as const };
      }

      return registerApprovedDevice(input);
    },

    async enableJobNotifications(input: EnableJobNotificationsInput) {
      const existing = await notifications.getPermissionsAsync();
      if (isGranted(existing)) {
        return registerApprovedDevice(input);
      }
      if (cannotAskAgain(existing)) {
        await openSettings?.();
        return { status: "settings-required" as const };
      }

      const permission = await requestNotificationPermission(notifications);
      if (cannotAskAgain(permission)) {
        await openSettings?.();
        return { status: "settings-required" as const };
      }
      if (!isGranted(permission)) {
        return { status: "not-granted" as const };
      }

      return registerApprovedDevice(input);
    },
  };
}

function requestNotificationPermission(
  notifications: PushRegistrationNotifications,
) {
  return notifications.requestPermissionsAsync({
    android: {},
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });
}

function isGranted(permission: NotificationPermissionResult): boolean {
  return Boolean(permission.granted) || permission.status === "granted";
}

function cannotAskAgain(permission: NotificationPermissionResult): boolean {
  return permission.status === "denied" && permission.canAskAgain !== true;
}

export function redactPushToken(token: string): string {
  if (token.length <= 10) {
    return "••••";
  }
  return `${token.slice(0, 8)}…${token.slice(-6)}`;
}

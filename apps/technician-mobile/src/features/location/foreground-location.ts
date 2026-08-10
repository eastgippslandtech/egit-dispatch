export interface ForegroundLocationPermissions {
  getForegroundPermissionsAsync?: () => Promise<LocationPermissionResult>;
  requestForegroundPermissionsAsync(): Promise<LocationPermissionResult>;
}

export interface LocationPermissionResult {
  canAskAgain?: boolean;
  granted?: boolean;
  status: string;
}

export async function enableWhileUsingLocation(
  location: ForegroundLocationPermissions,
  options: { openSettings?: () => Promise<void> } = {},
): Promise<string> {
  const existing = await location.getForegroundPermissionsAsync?.();
  if (isGranted(existing)) {
    return "Location enabled while using";
  }
  if (cannotAskAgain(existing)) {
    await options.openSettings?.();
    return "Open phone settings to enable location while using";
  }

  const permission = await location.requestForegroundPermissionsAsync();
  if (isGranted(permission)) {
    return "Location enabled while using";
  }
  if (cannotAskAgain(permission)) {
    await options.openSettings?.();
    return "Open phone settings to enable location while using";
  }

  return permission.status === "granted"
    ? "Location enabled while using"
    : "Location permission not granted";
}

function isGranted(permission: LocationPermissionResult | undefined): boolean {
  return Boolean(permission?.granted) || permission?.status === "granted";
}

function cannotAskAgain(
  permission: LocationPermissionResult | undefined,
): boolean {
  return permission?.status === "denied" && permission.canAskAgain === false;
}

export interface ForegroundLocationPermissions {
  requestForegroundPermissionsAsync(): Promise<{ status: string }>;
}

export async function enableWhileUsingLocation(
  location: ForegroundLocationPermissions,
): Promise<string> {
  const permission = await location.requestForegroundPermissionsAsync();
  return permission.status === "granted"
    ? "Location enabled while using"
    : "Location permission not granted";
}

interface LocationProvider {
  getCurrentPosition(): Promise<{
    coords: { latitude: number; longitude: number };
    timestamp: number;
  }>;
  requestForegroundPermissions(): Promise<{ status: string }>;
  watchPosition?: (...args: unknown[]) => unknown;
}

interface EtaDestination {
  destinationAddress: string;
  travelMinutesFallback: number;
}

export function createEtaService({
  location,
}: {
  location: LocationProvider;
}) {
  return {
    async calculate(destination: EtaDestination) {
      const permission = await location.requestForegroundPermissions();
      if (permission.status !== "granted") {
        return {
          display: "Location permission denied. Open maps to estimate travel.",
          persisted: {
            calculatedAt: new Date(0).toISOString(),
            permission: "denied",
          },
        };
      }

      await location.getCurrentPosition();
      return {
        display: `${destination.travelMinutesFallback} min estimated travel`,
        persisted: {
          calculatedAt: new Date(0).toISOString(),
          destinationAddress: destination.destinationAddress,
          permission: "granted",
          travelMinutes: destination.travelMinutesFallback,
        },
      };
    },
  };
}

export async function calculateOnDemandEta(
  service: ReturnType<typeof createEtaService>,
  destination: EtaDestination,
) {
  return service.calculate(destination);
}

export async function openPreferredMaps(address: string): Promise<boolean> {
  const { Linking } = await import("react-native");
  const url = `https://maps.apple.com/?q=${encodeURIComponent(address)}`;
  const supported = await Linking.canOpenURL(url);
  if (!supported) return false;
  await Linking.openURL(url);
  return true;
}

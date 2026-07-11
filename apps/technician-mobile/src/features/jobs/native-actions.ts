import { Linking } from "react-native";

export interface NativeActions {
  openEmail(email: string | null): Promise<boolean>;
  openMaps(address: string | null): Promise<boolean>;
  openOutlookEvent(url: string | null): Promise<boolean>;
  openPhone(phone: string | null): Promise<boolean>;
}

export function createNativeActions(): NativeActions {
  return {
    openEmail: (email) =>
      openIfSupported(email ? `mailto:${encodeURIComponent(email)}` : null),
    openMaps: (address) =>
      openIfSupported(
        address
          ? `https://maps.apple.com/?q=${encodeURIComponent(address)}`
          : null,
      ),
    openOutlookEvent: (url) => openIfSupported(url),
    openPhone: (phone) => openIfSupported(phone ? `tel:${phone}` : null),
  };
}

async function openIfSupported(url: string | null): Promise<boolean> {
  if (!url) {
    return false;
  }

  const supported = await Linking.canOpenURL(url);
  if (!supported) {
    return false;
  }

  await Linking.openURL(url);
  return true;
}

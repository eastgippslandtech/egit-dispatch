import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "EGIT Command Centre",
  owner: "eastgippslandtechs-team",
  slug: "egit-command-centre-technician",
  scheme: "egitcommand",
  version: "0.1.2",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  icon: "./assets/brand/app-icon.png",
  ios: {
    bundleIdentifier: "au.com.egit.commandcentre",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      LSApplicationQueriesSchemes: ["egitpayments"],
      NSCameraUsageDescription:
        "Command Centre uses the camera only when you choose to capture job evidence.",
      NSLocationWhenInUseUsageDescription:
        "Command Centre uses your location while using the app for ETA and navigation helpers. It does not track you in the background.",
      NSPhotoLibraryUsageDescription:
        "Command Centre lets you choose photos only when attaching job evidence.",
    },
    supportsTablet: false,
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#071526",
      foregroundImage: "./assets/brand/app-icon.png",
    },
    permissions: [
      "CAMERA",
      "ACCESS_COARSE_LOCATION",
      "ACCESS_FINE_LOCATION",
      "POST_NOTIFICATIONS",
    ],
    package: "au.com.egit.commandcentre",
  },
  plugins: [
    "expo-font",
    "expo-router",
    "expo-secure-store",
    "expo-sqlite",
    [
      "expo-camera",
      {
        cameraPermission:
          "Command Centre uses the camera only when you choose to capture job evidence.",
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission:
          "Command Centre lets you choose photos only when attaching job evidence.",
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Command Centre uses your location while using the app for ETA and navigation helpers. It does not track you in the background.",
      },
    ],
    "expo-notifications",
  ],
  extra: {
    eas: {
      projectId: "69887271-c3b6-435e-9184-290a27c196cd",
    },
  },
  experiments: { typedRoutes: true },
};

export default config;

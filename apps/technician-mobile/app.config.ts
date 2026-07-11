import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Command Centre",
  slug: "egit-command-centre-technician",
  scheme: "egitcommand",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  icon: "./assets/brand/app-icon.png",
  ios: {
    bundleIdentifier: "au.com.egit.commandcentre",
    infoPlist: {
      NSCameraUsageDescription:
        "Command Centre uses the camera only when you choose to capture job evidence.",
      NSLocationWhenInUseUsageDescription:
        "Command Centre uses your location only when you tap Calculate ETA.",
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
    permissions: ["CAMERA", "ACCESS_FINE_LOCATION", "POST_NOTIFICATIONS"],
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
          "Command Centre uses your location only when you tap Calculate ETA.",
      },
    ],
    "expo-notifications",
  ],
  experiments: { typedRoutes: true },
};

export default config;

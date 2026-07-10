import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Command Centre",
  slug: "egit-command-centre-technician",
  scheme: "egitcommand",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  ios: {
    bundleIdentifier: "au.com.egit.commandcentre",
    supportsTablet: false,
  },
  android: {
    package: "au.com.egit.commandcentre",
  },
  plugins: ["expo-font", "expo-router", "expo-secure-store", "expo-sqlite"],
  experiments: { typedRoutes: true },
};

export default config;

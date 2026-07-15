import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Tabs } from "expo-router";

import { colours } from "../../src/theme/tokens";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colours.surface },
        headerTintColor: colours.text,
        headerTitleStyle: { fontWeight: "700" },
        sceneStyle: { backgroundColor: colours.canvas },
        tabBarActiveTintColor: colours.primary,
        tabBarInactiveTintColor: colours.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
        tabBarStyle: {
          backgroundColor: colours.surface,
          borderTopColor: colours.border,
        },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          tabBarAccessibilityLabel: "Today tab",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              accessibilityElementsHidden
              color={color}
              importantForAccessibility="no-hide-descendants"
              name="calendar-today"
              size={size}
            />
          ),
          title: "Today",
        }}
      />
      <Tabs.Screen
        name="my-work"
        options={{
          tabBarAccessibilityLabel: "My Work tab",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              accessibilityElementsHidden
              color={color}
              importantForAccessibility="no-hide-descendants"
              name="clipboard-text-outline"
              size={size}
            />
          ),
          title: "My Work",
        }}
      />
      <Tabs.Screen
        name="sync"
        options={{
          href: null,
          tabBarAccessibilityLabel: "Sync tab",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              accessibilityElementsHidden
              color={color}
              importantForAccessibility="no-hide-descendants"
              name="sync"
              size={size}
            />
          ),
          title: "Sync",
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarAccessibilityLabel: "Profile and Settings tab",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              accessibilityElementsHidden
              color={color}
              importantForAccessibility="no-hide-descendants"
              name="account-cog-outline"
              size={size}
            />
          ),
          title: "Profile & Settings",
        }}
      />
    </Tabs>
  );
}

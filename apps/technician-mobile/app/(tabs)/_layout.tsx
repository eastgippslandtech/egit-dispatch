import { Tabs } from "expo-router";
import { StyleSheet, Text, type ColorValue } from "react-native";

import { colours } from "../../src/theme/tokens";

type TabIconProps = {
  colour: ColorValue;
  symbol: string;
};

function TabIcon({ colour, symbol }: TabIconProps) {
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.icon, { color: colour }]}
    >
      {symbol}
    </Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colours.surface },
        headerTintColor: colours.text,
        headerTitleStyle: { fontWeight: "700" },
        sceneStyle: { backgroundColor: colours.canvas },
        tabBarActiveTintColor: colours.cyan,
        tabBarInactiveTintColor: colours.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
        tabBarStyle: {
          backgroundColor: colours.surface,
          borderTopColor: colours.border,
          height: 68,
          paddingBottom: 8,
          paddingTop: 6,
        },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          tabBarAccessibilityLabel: "Today tab",
          tabBarIcon: ({ color }) => <TabIcon colour={color} symbol="◉" />,
          title: "Today",
        }}
      />
      <Tabs.Screen
        name="my-work"
        options={{
          tabBarAccessibilityLabel: "My Work tab",
          tabBarIcon: ({ color }) => <TabIcon colour={color} symbol="≡" />,
          title: "My Work",
        }}
      />
      <Tabs.Screen
        name="sync"
        options={{
          tabBarAccessibilityLabel: "Sync tab",
          tabBarIcon: ({ color }) => <TabIcon colour={color} symbol="↻" />,
          title: "Sync",
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarAccessibilityLabel: "Profile tab",
          tabBarIcon: ({ color }) => <TabIcon colour={color} symbol="●" />,
          title: "Profile",
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: {
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 24,
  },
});

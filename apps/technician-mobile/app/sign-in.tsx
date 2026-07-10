import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSession } from "../src/providers/app-providers";
import { colours } from "../src/theme/tokens";

export default function SignInRoute() {
  const { signInWithZoho } = useSession();

  return (
    <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.identity}>
          <Text style={styles.eyebrow}>COMMAND CENTRE</Text>
          <Text accessibilityRole="header" style={styles.title}>
            Technician
          </Text>
          <Text style={styles.description}>
            Your field workspace for assigned work and service updates.
          </Text>
        </View>

        <Pressable
          accessibilityHint="Signs in with the approved mock technician session"
          accessibilityLabel="Sign in with Zoho"
          accessibilityRole="button"
          onPress={signInWithZoho}
          style={({ pressed }) => [
            styles.signInButton,
            pressed && styles.signInButtonPressed,
          ]}
        >
          <Text style={styles.signInButtonText}>Sign in with Zoho</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  description: {
    color: colours.muted,
    fontSize: 17,
    lineHeight: 25,
    marginTop: 12,
    maxWidth: 360,
  },
  eyebrow: {
    color: colours.cyan,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.6,
  },
  identity: {
    marginTop: 72,
  },
  safeArea: {
    backgroundColor: colours.canvas,
    flex: 1,
  },
  signInButton: {
    alignItems: "center",
    backgroundColor: colours.cyan,
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 56,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  signInButtonPressed: {
    opacity: 0.8,
  },
  signInButtonText: {
    color: colours.canvas,
    fontSize: 17,
    fontWeight: "700",
  },
  title: {
    color: colours.text,
    fontSize: 38,
    fontWeight: "700",
    letterSpacing: -0.8,
    marginTop: 8,
  },
});

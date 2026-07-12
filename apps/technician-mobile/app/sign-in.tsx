import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import brandMarkImage from "../assets/brand/app-icon.png";
import { useSession } from "../src/providers/app-providers";
import { colours } from "../src/theme/tokens";

const brandMark: ImageSourcePropType =
  typeof brandMarkImage === "string" ? { uri: brandMarkImage } : brandMarkImage;

export default function SignInRoute() {
  const { isSigningIn, signInError, signInWithZoho } = useSession();

  return (
    <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.identity}>
          <View style={styles.brandLockup}>
            <Image
              accessibilityLabel="Command Centre brand mark"
              accessibilityRole="image"
              alt="Command Centre brand mark"
              source={brandMark}
              style={styles.brandMark}
            />
            <View style={styles.wordmarkGroup}>
              <Text style={styles.eyebrow}>COMMAND CENTRE</Text>
              <View accessibilityElementsHidden style={styles.accentLine}>
                <View style={styles.accentOrange} />
                <View style={styles.accentRed} />
              </View>
            </View>
          </View>
          <Text accessibilityRole="header" style={styles.title}>
            Technician
          </Text>
          <Text style={styles.description}>
            Your field workspace for assigned work and service updates.
          </Text>
        </View>

        <Pressable
          accessibilityHint="Opens Zoho so you can choose and approve your EGIT account"
          accessibilityLabel="Sign in with Zoho"
          accessibilityRole="button"
          disabled={isSigningIn}
          onPress={() => {
            void signInWithZoho();
          }}
          style={({ pressed }) => [
            styles.signInButton,
            isSigningIn && styles.signInButtonDisabled,
            pressed && styles.signInButtonPressed,
          ]}
        >
          <Text style={styles.signInButtonText}>
            {isSigningIn ? "Opening Zoho…" : "Sign in with Zoho"}
          </Text>
        </Pressable>
        {signInError ? (
          <Text accessibilityRole="alert" style={styles.errorText}>
            {signInError}
          </Text>
        ) : null}
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
  accentLine: {
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
  },
  accentOrange: {
    backgroundColor: colours.brandOrange,
    borderRadius: 999,
    height: 4,
    width: 56,
  },
  accentRed: {
    backgroundColor: colours.brandRed,
    borderRadius: 999,
    height: 4,
    width: 22,
  },
  brandLockup: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
  },
  brandMark: {
    borderRadius: 20,
    height: 76,
    width: 76,
  },
  description: {
    color: colours.muted,
    fontSize: 17,
    lineHeight: 25,
    marginTop: 12,
    maxWidth: 360,
  },
  eyebrow: {
    color: colours.text,
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
    backgroundColor: colours.primary,
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 56,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  signInButtonPressed: {
    opacity: 0.8,
  },
  signInButtonDisabled: {
    opacity: 0.6,
  },
  signInButtonText: {
    color: colours.textOnWarm,
    fontSize: 17,
    fontWeight: "700",
  },
  errorText: {
    color: colours.critical,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
    textAlign: "center",
  },
  title: {
    color: colours.text,
    fontSize: 38,
    fontWeight: "700",
    letterSpacing: -0.8,
    marginTop: 28,
  },
  wordmarkGroup: {
    justifyContent: "center",
  },
});

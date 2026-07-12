import { useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
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
  const {
    isSigningIn,
    signInError,
    signInWithReviewerDemo,
    signInWithZoho,
  } = useSession();
  const [, setReviewerTapCount] = useState(0);
  const [isReviewerDemoVisible, setIsReviewerDemoVisible] = useState(false);
  const [reviewerDemoCode, setReviewerDemoCode] = useState("");
  const [reviewerDemoError, setReviewerDemoError] = useState<string | null>(
    null,
  );

  function handleBrandPress() {
    if (isReviewerDemoVisible) {
      return;
    }

    setReviewerTapCount((currentCount) => {
      const nextCount = currentCount + 1;
      if (nextCount >= 5) {
        setIsReviewerDemoVisible(true);
      }
      return nextCount;
    });
  }

  function handleReviewerDemoOpen() {
    if (!signInWithReviewerDemo(reviewerDemoCode)) {
      setReviewerDemoError("Reviewer demo code not recognised.");
      return;
    }

    setReviewerDemoError(null);
  }

  return (
    <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.identity}>
          <View style={styles.brandLockup}>
            <Pressable
              accessibilityLabel="Command Centre brand mark"
              accessibilityRole="imagebutton"
              onPress={handleBrandPress}
            >
              <Image
                accessibilityElementsHidden
                alt="Command Centre brand mark"
                importantForAccessibility="no-hide-descendants"
                source={brandMark}
                style={styles.brandMark}
              />
            </Pressable>
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
        {isReviewerDemoVisible ? (
          <View
            accessibilityLabel="Reviewer demo access"
            style={styles.reviewerDemoPanel}
          >
            <Text style={styles.reviewerDemoTitle}>Reviewer demo access</Text>
            <Text style={styles.reviewerDemoDescription}>
              Enter the review code supplied in App Review notes to open the
              sandbox technician workspace.
            </Text>
            <TextInput
              accessibilityLabel="Reviewer demo code"
              autoCapitalize="characters"
              onChangeText={setReviewerDemoCode}
              placeholder="Review code"
              placeholderTextColor={colours.muted}
              style={styles.reviewerDemoInput}
              value={reviewerDemoCode}
            />
            <Pressable
              accessibilityLabel="Open reviewer demo"
              accessibilityRole="button"
              onPress={handleReviewerDemoOpen}
              style={({ pressed }) => [
                styles.reviewerDemoButton,
                pressed && styles.signInButtonPressed,
              ]}
            >
              <Text style={styles.reviewerDemoButtonText}>
                Open reviewer demo
              </Text>
            </Pressable>
            {reviewerDemoError ? (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {reviewerDemoError}
              </Text>
            ) : null}
          </View>
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
  reviewerDemoPanel: {
    backgroundColor: colours.surface,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    marginTop: 16,
    padding: 16,
  },
  reviewerDemoTitle: {
    color: colours.text,
    fontSize: 16,
    fontWeight: "700",
  },
  reviewerDemoDescription: {
    color: colours.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  reviewerDemoInput: {
    borderColor: colours.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colours.text,
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  reviewerDemoButton: {
    alignItems: "center",
    borderColor: colours.primary,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  reviewerDemoButtonText: {
    color: colours.primary,
    fontSize: 15,
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

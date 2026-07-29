import { Pressable, StyleSheet, Text } from "react-native";

import { colours } from "../theme/tokens";

type AppButtonVariant = "primary" | "secondary" | "danger" | "navy";

export function AppButton({
  accessibilityLabel,
  disabled = false,
  label,
  onPress,
  variant = "primary",
}: {
  accessibilityLabel?: string;
  disabled?: boolean;
  label: string;
  onPress: () => void | Promise<void>;
  variant?: AppButtonVariant;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.label, variant === "primary" && styles.labelOnWarm]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  danger: {
    backgroundColor: colours.critical,
  },
  disabled: {
    opacity: 0.55,
  },
  label: {
    color: colours.text,
    fontSize: 15,
    fontWeight: "900",
    lineHeight: 20,
    textAlign: "center",
  },
  labelOnWarm: {
    color: colours.textOnWarm,
  },
  navy: {
    backgroundColor: colours.brandNavy,
  },
  pressed: {
    opacity: 0.82,
  },
  primary: {
    backgroundColor: colours.primary,
  },
  secondary: {
    backgroundColor: colours.surfaceRaised,
    borderColor: colours.border,
    borderWidth: 1,
  },
});

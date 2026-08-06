import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colours } from "../../theme/tokens";
import { createSignOffCommand } from "./sign-off-service";

export { createSignOffCommand };

export function SignOffForm({
  baseVersion,
  installationId,
  jobId,
}: {
  baseVersion: string;
  installationId: string;
  jobId: string;
}) {
  const [accepted, setAccepted] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [signatureLocalUri] = useState<string | null>(null);

  return (
    <View style={styles.form}>
      <Text style={styles.title}>Customer sign-off</Text>
      <TextInput
        accessibilityLabel="Customer name"
        onChangeText={setCustomerName}
        style={styles.input}
        value={customerName}
      />
      <Pressable
        accessibilityLabel="Customer accepted work"
        accessibilityRole="checkbox"
        onPress={() => setAccepted((value) => !value)}
        style={styles.option}
      >
        <Text style={styles.optionText}>{accepted ? "Accepted" : "Tap to accept"}</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Save sign-off"
        accessibilityRole="button"
        onPress={() => {
          try {
            createSignOffCommand({
              accepted,
              baseVersion,
              customerName,
              installationId,
              jobId,
              occurredAt: new Date().toISOString(),
              signatureLocalUri,
            });
            setMessage("Queued");
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "Sign-off failed.");
          }
        }}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Save sign-off</Text>
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: colours.primary, borderRadius: 14, padding: 14 },
  buttonText: { color: colours.textOnWarm, fontWeight: "900", textAlign: "center" },
  form: { gap: 10 },
  input: {
    backgroundColor: colours.surfaceRaised,
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colours.text,
    padding: 12,
  },
  message: { color: colours.muted },
  option: {
    backgroundColor: colours.surfaceRaised,
    borderRadius: 14,
    padding: 12,
  },
  optionText: { color: colours.text, fontWeight: "800" },
  title: { color: colours.text, fontSize: 18, fontWeight: "900" },
});

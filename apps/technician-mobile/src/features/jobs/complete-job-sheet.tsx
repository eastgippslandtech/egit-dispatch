import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { MobileJob } from "../../contracts/mobile";
import { colours } from "../../theme/tokens";
import { completeJobLocally } from "../worklogs/worklog-service";

export function CompleteJobSheet({ job }: { job: MobileJob }) {
  const [message, setMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState("");

  return (
    <View style={styles.sheet}>
      <Text style={styles.title}>Complete job</Text>
      <TextInput
        accessibilityLabel="Completion note"
        onChangeText={setSummary}
        style={styles.input}
        value={summary}
      />
      <Pressable
        accessibilityLabel="Complete job"
        accessibilityRole="button"
        onPress={() => {
          try {
            completeJobLocally({
              followUpNeeded: false,
              job,
              summary,
              visibility: "internal",
            });
            setMessage("Queued for sync");
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "Completion failed.");
          }
        }}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Complete job</Text>
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colours.primary,
    borderRadius: 14,
    padding: 14,
  },
  buttonText: {
    color: colours.textOnWarm,
    fontWeight: "900",
    textAlign: "center",
  },
  input: {
    backgroundColor: colours.surfaceRaised,
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colours.text,
    minHeight: 80,
    padding: 12,
  },
  message: {
    color: colours.muted,
  },
  sheet: {
    gap: 12,
  },
  title: {
    color: colours.text,
    fontSize: 18,
    fontWeight: "900",
  },
});

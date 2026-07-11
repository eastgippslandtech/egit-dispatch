import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colours } from "../../theme/tokens";
import { createPartUsedCommand } from "./parts-service";

export function PartsForm({
  baseVersion,
  installationId,
  jobId,
}: {
  baseVersion: string;
  installationId: string;
  jobId: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");

  return (
    <View style={styles.form}>
      <Text style={styles.title}>Parts used</Text>
      <TextInput accessibilityLabel="Part name" onChangeText={setName} style={styles.input} value={name} />
      <TextInput
        accessibilityLabel="Quantity"
        keyboardType="number-pad"
        onChangeText={setQuantity}
        style={styles.input}
        value={quantity}
      />
      <Pressable
        accessibilityLabel="Add part"
        accessibilityRole="button"
        onPress={() => {
          try {
            createPartUsedCommand({
              baseVersion,
              installationId,
              jobId,
              name,
              occurredAt: new Date().toISOString(),
              quantity: Number(quantity),
              sku: null,
            });
            setMessage("Queued");
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "Part could not be added.");
          }
        }}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Add part</Text>
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
  title: { color: colours.text, fontSize: 18, fontWeight: "900" },
});

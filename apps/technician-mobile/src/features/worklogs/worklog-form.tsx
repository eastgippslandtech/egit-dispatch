import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { MobileJob, NoteVisibility } from "../../contracts/mobile";
import { colours } from "../../theme/tokens";
import { createWorklogDraftStore, saveWorklogWithDraft } from "./worklog-service";

export function WorklogForm({
  job,
  technicianId,
}: {
  job: MobileJob;
  technicianId: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [visibility, setVisibility] = useState<NoteVisibility>("internal");
  const [draftStore] = useState(() => createWorklogDraftStore());

  return (
    <View style={styles.form}>
      <Text style={styles.title}>Work note</Text>
      <TextInput
        accessibilityLabel="Work note"
        multiline
        onChangeText={setNote}
        style={styles.input}
        value={note}
      />
      <View style={styles.row}>
        {(["internal", "external"] as const).map((option) => (
          <Pressable
            accessibilityLabel={`${option === "internal" ? "Internal" : "External"} note`}
            accessibilityRole="button"
            key={option}
            onPress={() => setVisibility(option)}
            style={[
              styles.option,
              visibility === option && styles.optionSelected,
            ]}
          >
            <Text style={styles.optionText}>{option}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityLabel="Save worklog"
        accessibilityRole="button"
        onPress={() => {
          void saveWorklogWithDraft({
            draftStore,
            job,
            note,
            technicianId,
            visibility,
          })
            .then((result) => setMessage(result.status))
            .catch((error: unknown) =>
              setMessage(error instanceof Error ? error.message : "Save failed."),
            );
        }}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Save worklog</Text>
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
  form: {
    gap: 12,
  },
  input: {
    backgroundColor: colours.surfaceRaised,
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colours.text,
    minHeight: 96,
    padding: 12,
  },
  message: {
    color: colours.muted,
  },
  option: {
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  optionSelected: {
    backgroundColor: colours.surfaceWarm,
    borderColor: colours.primary,
  },
  optionText: {
    color: colours.text,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  title: {
    color: colours.text,
    fontSize: 18,
    fontWeight: "900",
  },
});

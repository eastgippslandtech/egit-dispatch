import { useState } from "react";
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { MobileJob, NoteVisibility, WorkLogType } from "../../contracts/mobile";
import { useTechnicianRepository } from "../../providers/app-providers";
import { colours } from "../../theme/tokens";
import { createWorklogDraftStore, saveWorklogWithDraft } from "./worklog-service";

export function WorklogForm({
  job,
  technicianId,
}: {
  job: MobileJob;
  technicianId: string;
}) {
  const repository = useTechnicianRepository();
  const [billable, setBillable] = useState(true);
  const [durationMinutes, setDurationMinutes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [visibility, setVisibility] = useState<NoteVisibility>("external");
  const [workType, setWorkType] = useState<WorkLogType>("billable");
  const [draftStore] = useState(() => createWorklogDraftStore());
  const latestNote = job.previousNotes[0]?.body ?? "No current notes recorded.";
  const duration = Number(durationMinutes);

  return (
    <View style={styles.form}>
      <Text style={styles.title}>Work Log</Text>
      <View style={styles.infoPanel}>
        <Text style={styles.infoTitle}>Latest job information</Text>
        <InfoLine label="Request number" value={job.requestNumber} />
        <InfoLine label="Subject" value={job.title} />
        <InfoLine
          label="Customer/site"
          value={[job.customerName, job.siteName].filter(Boolean).join(" / ")}
        />
        <InfoLine label="Status" value={job.status} />
        <InfoLine label="Priority" value={job.priority} />
        <InfoLine label="Technician" value={job.technician.displayName} />
        <InfoLine label="Scheduled time" value={`${job.startAt} - ${job.endAt}`} />
        <InfoLine label="Due time" value={job.slaDueAt} />
        <InfoLine label="Booking type" value={job.bookingType} />
        <InfoLine label="Contact" value={job.contactName} />
        <InfoLine
          label="Site/address"
          value={job.siteAddress ?? job.siteName}
        />
        <InfoLine label="Current/latest notes" value={latestNote} />
      </View>
      <Text style={styles.label}>Work Log notes</Text>
      <TextInput
        accessibilityLabel="Work Log notes"
        blurOnSubmit
        multiline
        onChangeText={setNote}
        onSubmitEditing={() => Keyboard.dismiss()}
        returnKeyType="done"
        submitBehavior="blurAndSubmit"
        style={styles.input}
        value={note}
      />
      <Text style={styles.label}>Time spent</Text>
      <TextInput
        accessibilityLabel="Time spent"
        keyboardType="number-pad"
        onChangeText={setDurationMinutes}
        placeholder="Minutes"
        placeholderTextColor={colours.muted}
        style={styles.singleInput}
        value={durationMinutes}
      />
      <Text style={styles.label}>Work type</Text>
      <View style={styles.row}>
        {(["billable", "non_billable", "internal"] as const).map((option) => (
          <Pressable
            accessibilityLabel={workLogTypeLabel(option)}
            accessibilityRole="button"
            accessibilityState={{ selected: workType === option }}
            key={option}
            onPress={() => setWorkType(option)}
            style={[
              styles.option,
              workType === option && styles.optionSelected,
            ]}
          >
            <Text style={styles.optionText}>{workLogTypeLabel(option)}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Visibility</Text>
      <View style={styles.row}>
        {(["external", "internal"] as const).map((option) => (
          <Pressable
            accessibilityLabel={option === "internal" ? "Internal" : "Customer-facing"}
            accessibilityRole="button"
            accessibilityState={{ selected: visibility === option }}
            key={option}
            onPress={() => setVisibility(option)}
            style={[
              styles.option,
              visibility === option && styles.optionSelected,
            ]}
          >
            <Text style={styles.optionText}>
              {option === "internal" ? "Internal" : "Customer-facing"}
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityLabel="Billable"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: billable }}
        onPress={() => setBillable((current) => !current)}
        style={[styles.option, billable && styles.optionSelected]}
      >
        <Text style={styles.optionText}>Billable</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Save Work Log"
        accessibilityRole="button"
        onPress={() => {
          void saveWorklogWithDraft({
            billable,
            draftStore,
            durationMinutes: Number.isFinite(duration) ? duration : 0,
            job,
            note,
            submit: (command) => repository.saveWorklog(command),
            technicianId,
            visibility,
            workType,
          })
            .then((result) => setMessage(result.status))
            .catch((error: unknown) =>
              setMessage(error instanceof Error ? error.message : "Save failed."),
            );
        }}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Save Work Log</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Save and complete ticket"
        accessibilityRole="button"
        onPress={() => {
          void repository
            .completeJob({
              baseVersion: job.version,
              billable,
              clientMutationId: `complete-${job.id}-${Date.now()}`,
              durationMinutes: Number.isFinite(duration) ? duration : undefined,
              followUpNeeded: false,
              installationId: "local-simulator",
              jobId: job.id,
              occurredAt: new Date().toISOString(),
              summary: note,
              visibility,
              workType,
            })
            .then(() => setMessage("completed"))
            .catch((error: unknown) =>
              setMessage(error instanceof Error ? error.message : "Save failed."),
            );
        }}
        style={styles.secondaryButton}
      >
        <Text style={styles.secondaryButtonText}>Save and complete ticket</Text>
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

function InfoLine({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return <Text style={styles.infoLine}>{`${label}: ${value}`}</Text>;
}

function workLogTypeLabel(value: WorkLogType) {
  if (value === "non_billable") return "Non-billable";
  if (value === "internal") return "Internal";
  return "Billable";
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
  infoLine: {
    color: colours.text,
    fontSize: 13,
    fontWeight: "700",
  },
  infoPanel: {
    backgroundColor: colours.surfaceRaised,
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  infoTitle: {
    color: colours.text,
    fontSize: 16,
    fontWeight: "900",
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
  label: {
    color: colours.text,
    fontSize: 14,
    fontWeight: "900",
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
    flexWrap: "wrap",
    flexDirection: "row",
    gap: 8,
  },
  secondaryButton: {
    backgroundColor: colours.surfaceWarm,
    borderColor: colours.primary,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  secondaryButtonText: {
    color: colours.text,
    fontWeight: "900",
    textAlign: "center",
  },
  singleInput: {
    backgroundColor: colours.surfaceRaised,
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colours.text,
    padding: 12,
  },
  title: {
    color: colours.text,
    fontSize: 18,
    fontWeight: "900",
  },
});

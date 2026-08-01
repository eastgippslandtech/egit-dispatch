import { useState } from "react";
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type {
  BookingType,
  MobileJob,
  MobileStaff,
  NoteVisibility,
  WorklogDisposition,
  WorkLogType,
} from "../../contracts/mobile";
import { useTechnicianRepository } from "../../providers/app-providers";
import { colours } from "../../theme/tokens";
import { getMobileChargeableTime } from "./chargeable-time";
import { createWorklogDraftStore, saveWorklogWithDraft } from "./worklog-service";

export function WorklogForm({
  job,
  technicianId,
}: {
  job: MobileJob;
  technicianId: string;
}) {
  const repository = useTechnicianRepository();
  const chargeableTime = getMobileChargeableTime(job);
  const [durationMinutes, setDurationMinutes] = useState(
    chargeableTime.totalMinutes > 0 ? String(chargeableTime.totalMinutes) : "",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [visibility, setVisibility] = useState<NoteVisibility>("external");
  const [workType, setWorkType] = useState<WorkLogType>("billable");
  const [disposition, setDisposition] = useState<WorklogDisposition>();
  const [idempotencyKey] = useState(
    () => `worklog-${job.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const [forwardTechnicianId, setForwardTechnicianId] = useState(
    job.technician.id,
  );
  const [forwardDate, setForwardDate] = useState(nextDate(job.startAt));
  const [forwardStart, setForwardStart] = useState("09:00");
  const [forwardEnd, setForwardEnd] = useState("10:00");
  const [forwardBookingType, setForwardBookingType] =
    useState<BookingType>(job.bookingType);
  const [transferTargetId, setTransferTargetId] = useState("");
  const [transferReason, setTransferReason] = useState("");
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
        {chargeableTime.travelMinutes > 0 ? (
          <InfoLine
            label="Chargeable time"
            value={`${chargeableTime.jobMinutes} min job + ${chargeableTime.travelMinutes} min travel = ${chargeableTime.totalMinutes} min`}
          />
        ) : null}
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
            onPress={() => {
              setWorkType(option);
              if (option === "billable") setVisibility("external");
              if (option === "internal") setVisibility("internal");
            }}
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
            disabled={
              (workType === "billable" && option === "internal") ||
              (workType === "internal" && option === "external")
            }
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

      <Text style={styles.label}>Outcome</Text>
      <View style={styles.outcomes}>
        {(
          [
            ["complete", "Complete ticket"],
            ["return_to_queue", "Return to queue"],
            ["book_forward", "Book forward"],
            ["transfer_escalate", "Transfer / escalate"],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="radio"
            accessibilityState={{ selected: disposition === value }}
            key={value}
            onPress={() => setDisposition(value)}
            style={[
              styles.outcome,
              disposition === value && styles.optionSelected,
            ]}
          >
            <Text style={styles.optionText}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {disposition === "book_forward" ? (
        <View style={styles.conditionalPanel}>
          <Text style={styles.label}>Forward technician</Text>
          <View style={styles.row}>
            {MOBILE_TECHNICIANS.map((staff) => (
              <Pressable
                accessibilityLabel={`Forward to ${staff.displayName}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: forwardTechnicianId === staff.id }}
                key={staff.id}
                onPress={() => setForwardTechnicianId(staff.id)}
                style={[
                  styles.option,
                  forwardTechnicianId === staff.id && styles.optionSelected,
                ]}
              >
                <Text style={styles.optionText}>{staff.displayName}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel="Forward date"
            onChangeText={setForwardDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colours.muted}
            style={styles.singleInput}
            value={forwardDate}
          />
          <View style={styles.twoColumns}>
            <TextInput
              accessibilityLabel="Forward start time"
              onChangeText={setForwardStart}
              placeholder="09:00"
              placeholderTextColor={colours.muted}
              style={[styles.singleInput, styles.flexInput]}
              value={forwardStart}
            />
            <TextInput
              accessibilityLabel="Forward end time"
              onChangeText={setForwardEnd}
              placeholder="10:00"
              placeholderTextColor={colours.muted}
              style={[styles.singleInput, styles.flexInput]}
              value={forwardEnd}
            />
          </View>
          <Text style={styles.label}>Booking type</Text>
          <View style={styles.row}>
            {(["Remote", "Onsite", "In house"] as const).map((type) => (
              <Pressable
                accessibilityLabel={`Forward ${type}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: forwardBookingType === type }}
                key={type}
                onPress={() => setForwardBookingType(type)}
                style={[
                  styles.option,
                  forwardBookingType === type && styles.optionSelected,
                ]}
              >
                <Text style={styles.optionText}>{type}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {disposition === "transfer_escalate" ? (
        <View style={styles.conditionalPanel}>
          <Text style={styles.label}>Transfer target</Text>
          <View style={styles.row}>
            {MOBILE_TECHNICIANS.map((staff) => (
              <Pressable
                accessibilityLabel={`Transfer to ${staff.displayName}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: transferTargetId === staff.id }}
                key={staff.id}
                onPress={() => setTransferTargetId(staff.id)}
                style={[
                  styles.option,
                  transferTargetId === staff.id && styles.optionSelected,
                ]}
              >
                <Text style={styles.optionText}>{staff.displayName}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel="Transfer reason"
            multiline
            onChangeText={setTransferReason}
            placeholder="Reason for transfer or escalation"
            placeholderTextColor={colours.muted}
            style={styles.input}
            value={transferReason}
          />
        </View>
      ) : null}

      <Pressable
        accessibilityLabel={submitLabel(disposition)}
        accessibilityRole="button"
        disabled={!disposition}
        onPress={() => {
          const forwardTechnician = MOBILE_TECHNICIANS.find(
            (staff) => staff.id === forwardTechnicianId,
          );
          const transferTarget = MOBILE_TECHNICIANS.find(
            (staff) => staff.id === transferTargetId,
          );
          void saveWorklogWithDraft({
            billable: workType === "billable",
            draftStore,
            disposition,
            durationMinutes: Number.isFinite(duration) ? duration : 0,
            forwardBooking:
              disposition === "book_forward" && forwardTechnician
                ? {
                    bookingType: forwardBookingType,
                    date: forwardDate,
                    end: forwardEnd,
                    start: forwardStart,
                    technicianEmail: forwardTechnician.mspCentralEmail,
                    technicianId: forwardTechnician.id,
                    technicianName: forwardTechnician.displayName,
                  }
                : undefined,
            idempotencyKey,
            job,
            note,
            submit: (command) => repository.saveWorklog(command),
            technicianId,
            transfer:
              disposition === "transfer_escalate" && transferTarget
                ? {
                    reason: transferReason,
                    targetEmail: transferTarget.mspCentralEmail,
                    targetTechnicianId: transferTarget.id,
                    targetTechnicianName: transferTarget.displayName,
                  }
                : undefined,
            visibility,
            workType,
          })
            .then((result) => setMessage(result.status))
            .catch((error: unknown) =>
              setMessage(error instanceof Error ? error.message : "Save failed."),
            );
        }}
        style={[styles.button, !disposition && styles.buttonDisabled]}
      >
        <Text style={styles.buttonText}>{submitLabel(disposition)}</Text>
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const MOBILE_TECHNICIANS: Pick<
  MobileStaff,
  "displayName" | "id" | "mspCentralEmail"
>[] = [
  { displayName: "Simeon", id: "staff-simeon", mspCentralEmail: "simeon@egit.com.au" },
  { displayName: "Matt", id: "staff-matt", mspCentralEmail: "mattd@egit.com.au" },
  { displayName: "Jervy", id: "staff-jervy", mspCentralEmail: "jervy@egit.com.au" },
  { displayName: "Riley", id: "staff-riley", mspCentralEmail: "riley@egit.com.au" },
];

function submitLabel(disposition?: WorklogDisposition) {
  if (disposition === "complete") return "Save Work Log and complete ticket";
  if (disposition === "return_to_queue") return "Save Work Log and return to queue";
  if (disposition === "book_forward") return "Save Work Log and book forward";
  if (disposition === "transfer_escalate") return "Save Work Log and transfer";
  return "Choose an outcome";
}

function nextDate(value: string) {
  const date = new Date(value);
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
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
  buttonDisabled: {
    opacity: 0.45,
  },
  conditionalPanel: {
    backgroundColor: colours.surfaceRaised,
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  flexInput: {
    flex: 1,
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
  outcome: {
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  outcomes: {
    gap: 8,
  },
  row: {
    flexWrap: "wrap",
    flexDirection: "row",
    gap: 8,
  },
  twoColumns: {
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

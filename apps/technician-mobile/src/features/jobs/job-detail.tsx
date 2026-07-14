import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { MobileJob } from "../../contracts/mobile";
import { AppButton } from "../../components/app-button";
import { useTechnicianRepository } from "../../providers/app-providers";
import { colours } from "../../theme/tokens";
import { useActiveTimer } from "../timer/active-timer-provider";
import { WorklogForm } from "../worklogs/worklog-form";
import { JobCard } from "./job-card";
import { createNativeActions } from "./native-actions";

interface JobDetailProps {
  jobId: string;
}

export function JobDetail({ jobId }: JobDetailProps) {
  const repository = useTechnicianRepository();
  const {
    activeTimer,
    isTimerForJob,
    startTimerForJob,
    stopActiveTimer,
    timerMessage,
  } = useActiveTimer();
  const actions = useMemo(() => createNativeActions(), []);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<MobileJob | null>(null);

  useEffect(() => {
    let cancelled = false;
    repository
      .getJob(jobId)
      .then((nextJob) => {
        if (!cancelled) {
          setJob(nextJob);
          setError(null);
        }
      })
      .catch((jobError: unknown) => {
        if (!cancelled) {
          setError(
            jobError instanceof Error ? jobError.message : "Job could not load.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [jobId, repository]);

  if (error) {
    return (
      <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
        <Text style={styles.error}>{error}</Text>
      </SafeAreaView>
    );
  }

  if (!job) {
    return (
      <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
        <Text style={styles.muted}>Loading job…</Text>
      </SafeAreaView>
    );
  }

  const readOnly = Boolean(job.permissions.readOnlyReason);
  const activeForThisJob = isTimerForJob(job.id);
  const timerRunningElsewhere = Boolean(activeTimer && !activeForThisJob);

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>{job.requestNumber ?? "Calendar event"}</Text>
        <Text accessibilityRole="header" style={styles.title}>
          {job.title}
        </Text>
        {readOnly ? <Text style={styles.readOnly}>Outlook Read Only</Text> : null}
        {timerMessage ? <Text style={styles.muted}>{timerMessage}</Text> : null}
        <JobCard job={job} />

        <Section title="Customer and site">
          <Detail label="Customer" value={job.customerName} />
          <Detail label="Site" value={job.siteName} />
          <Detail label="Address" value={job.siteAddress} />
          <Detail label="Contact" value={job.contactName} />
          <Detail label="Phone" value={job.contactPhone} />
          <Detail label="Email" value={job.contactEmail} />
        </Section>

        <Section title="Service context">
          <Detail label="Status" value={job.status} />
          <Detail label="Booking" value={job.bookingType} />
          <Detail label="SLA" value={job.slaDueAt} />
          <Detail label="Description" value={job.description} />
          <Detail label="Sync" value={job.syncState} />
        </Section>

        <Section title="Actions">
          {timerMessage ? (
            <Text accessibilityLabel={timerMessage} style={styles.muted}>
              {timerMessage}
            </Text>
          ) : null}
          <View style={styles.actionGrid}>
            <ActionButton
              disabled={!job.permissions.canStartTimer || timerRunningElsewhere}
              label={activeForThisJob ? "Stop timer" : "Start timer"}
              onPress={() => {
                void (activeForThisJob ? stopActiveTimer() : startTimerForJob(job));
              }}
            />
            <ActionButton
              disabled={!job.permissions.canComplete}
              label="Complete job"
              onPress={() => Alert.alert("Complete job", job.title)}
            />
            <ActionButton
              disabled={!job.contactPhone}
              label="Call contact"
              onPress={() => void actions.openPhone(job.contactPhone)}
            />
            <ActionButton
              disabled={!job.contactEmail}
              label="Email contact"
              onPress={() => void actions.openEmail(job.contactEmail)}
            />
            <ActionButton
              disabled={!job.siteAddress}
              label="Open in Maps"
              onPress={() => void actions.openMaps(job.siteAddress)}
            />
            <ActionButton
              disabled={!job.outlookWebLink}
              label="Open Outlook event"
              onPress={() => void actions.openOutlookEvent(job.outlookWebLink)}
            />
          </View>
        </Section>

        {job.permissions.canWriteWorklog ? (
          <Section title="Work note">
            <WorklogForm job={job} technicianId={job.technician.id} />
          </Section>
        ) : null}

        <Section title="Latest ticket notes">
          {job.previousNotes.length ? (
            job.previousNotes.map((note) => (
              <View key={note.id} style={styles.note}>
                <Text style={styles.noteMeta}>
                  {note.visibility} · {note.authorName}
                </Text>
                <Text style={styles.noteBody}>{note.body}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>No ticket notes yet.</Text>
          )}
        </Section>

        {job.permissions.readOnlyReason ? (
          <Text style={styles.muted}>{job.permissions.readOnlyReason}</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return <Text style={styles.detail}>{`${label}: ${value}`}</Text>;
}

function ActionButton({
  disabled,
  label,
  onPress,
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <AppButton
      accessibilityLabel={label}
      disabled={disabled}
      label={label}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  actionGrid: {
    gap: 10,
  },
  content: {
    gap: 14,
    paddingBottom: 30,
  },
  detail: {
    color: colours.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  detailLabel: {
    color: colours.text,
    fontWeight: "800",
  },
  error: {
    color: colours.critical,
    fontSize: 16,
  },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  muted: {
    color: colours.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  note: {
    backgroundColor: colours.surfaceRaised,
    borderRadius: 14,
    gap: 4,
    padding: 12,
  },
  noteBody: {
    color: colours.text,
    fontSize: 14,
  },
  noteMeta: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  readOnly: {
    color: colours.outlook,
    fontSize: 14,
    fontWeight: "900",
  },
  screen: {
    backgroundColor: colours.canvas,
    flex: 1,
    padding: 20,
  },
  section: {
    backgroundColor: colours.surface,
    borderColor: colours.border,
    borderRadius: 22,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  sectionTitle: {
    color: colours.text,
    fontSize: 18,
    fontWeight: "900",
  },
  title: {
    color: colours.text,
    fontSize: 32,
    fontWeight: "900",
    lineHeight: 38,
  },
});

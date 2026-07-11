import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ActiveTimer, MobileJob } from "../../contracts/mobile";
import { useTechnicianRepository } from "../../providers/app-providers";
import { colours } from "../../theme/tokens";
import { TimerBar } from "../timer/timer-bar";
import { WorklogForm } from "../worklogs/worklog-form";
import { JobCard } from "./job-card";
import { createNativeActions } from "./native-actions";

interface JobDetailProps {
  jobId: string;
}

export function JobDetail({ jobId }: JobDetailProps) {
  const repository = useTechnicianRepository();
  const actions = useMemo(() => createNativeActions(), []);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<MobileJob | null>(null);
  const [timerMessage, setTimerMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    repository
      .getJob(jobId)
      .then((nextJob) => {
        if (!cancelled) {
          setJob(nextJob);
          setError(null);
          void restoreActiveTimerSnapshot(nextJob.id).then((timer) => {
            if (!cancelled && timer) {
              setActiveTimer(timer);
              setTimerMessage("Timer running");
            }
          });
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
  const startJobTimer = () => {
    void repository
      .startTimer({
        baseVersion: job.version,
        clientMutationId: `timer-start-${job.id}-${Date.now()}`,
        installationId: "local-simulator",
        jobId: job.id,
        occurredAt: new Date().toISOString(),
      })
      .then((timer) => {
        setActiveTimer(timer);
        setTimerMessage("Timer running");
        void saveActiveTimerSnapshot(timer);
      })
      .catch((timerError: unknown) =>
        setTimerMessage(
          timerError instanceof Error
            ? timerError.message
            : "Timer could not start.",
        ),
      );
  };
  const stopJobTimer = () => {
    if (!activeTimer) return;
    void repository
      .stopTimer({
        baseVersion: job.version,
        clientMutationId: `timer-stop-${job.id}-${Date.now()}`,
        installationId: "local-simulator",
        jobId: job.id,
        occurredAt: new Date().toISOString(),
        timerId: activeTimer.id,
      })
      .then((stopped) => {
        setActiveTimer(null);
        setTimerMessage(`Timer stopped: ${stopped.roundedMinutes} minutes queued`);
        void clearActiveTimerSnapshot();
      })
      .catch((timerError: unknown) =>
        handleTimerStopFailure(timerError, activeTimer, setActiveTimer, setTimerMessage),
      );
  };

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>{job.requestNumber ?? "Calendar event"}</Text>
        <Text accessibilityRole="header" style={styles.title}>
          {job.title}
        </Text>
        {readOnly ? <Text style={styles.readOnly}>Outlook Read Only</Text> : null}
        {activeTimer ? (
          <TimerBar
            jobTitle={job.title}
            now={new Date()}
            onStop={stopJobTimer}
            timer={activeTimer}
          />
        ) : null}
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
              disabled={!job.permissions.canStartTimer}
              label={activeTimer ? "Stop timer" : "Start timer"}
              onPress={activeTimer ? stopJobTimer : startJobTimer}
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

        <Section title="Previous notes">
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
            <Text style={styles.muted}>No previous notes.</Text>
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
  return (
    <Text style={styles.detail}>
      <Text style={styles.detailLabel}>{label}: </Text>
      {value}
    </Text>
  );
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
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.actionButton, disabled && styles.actionButtonDisabled]}
    >
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const ACTIVE_TIMER_KEY = "command-centre.active-timer.v1";

async function saveActiveTimerSnapshot(timer: ActiveTimer): Promise<void> {
  const secureStore = await loadSecureStore();
  await secureStore?.setItemAsync(ACTIVE_TIMER_KEY, JSON.stringify(timer));
}

async function restoreActiveTimerSnapshot(
  jobId: string,
): Promise<ActiveTimer | null> {
  const secureStore = await loadSecureStore();
  const raw = await secureStore?.getItemAsync(ACTIVE_TIMER_KEY);
  if (!raw) return null;
  const timer = JSON.parse(raw) as ActiveTimer;
  return timer.jobId === jobId ? timer : null;
}

async function clearActiveTimerSnapshot(): Promise<void> {
  const secureStore = await loadSecureStore();
  await secureStore?.deleteItemAsync(ACTIVE_TIMER_KEY);
}

function handleTimerStopFailure(
  timerError: unknown,
  activeTimer: ActiveTimer,
  setActiveTimer: (timer: ActiveTimer | null) => void,
  setTimerMessage: (message: string) => void,
): void {
  const message =
    timerError instanceof Error ? timerError.message : "Timer could not stop.";
  if (message.includes("active timer does not match")) {
    setActiveTimer(null);
    setTimerMessage("Timer stopped: restored timer queued");
    void clearActiveTimerSnapshot();
    return;
  }
  setTimerMessage(message);
}

async function loadSecureStore(): Promise<
  | {
      deleteItemAsync(key: string): Promise<void>;
      getItemAsync(key: string): Promise<string | null>;
      setItemAsync(key: string, value: string): Promise<void>;
    }
  | null
> {
  try {
    return await import("expo-secure-store");
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  actionButton: {
    backgroundColor: colours.primary,
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actionButtonDisabled: {
    backgroundColor: colours.surfaceRaised,
    opacity: 0.55,
  },
  actionGrid: {
    gap: 10,
  },
  actionText: {
    color: colours.textOnWarm,
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center",
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

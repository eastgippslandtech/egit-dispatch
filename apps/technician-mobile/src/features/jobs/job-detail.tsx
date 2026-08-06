import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { MobileJob } from "../../contracts/mobile";
import { AppButton } from "../../components/app-button";
import { getMobileRuntimeConfig } from "../../config/runtime";
import { useTechnicianRepository } from "../../providers/app-providers";
import { colours } from "../../theme/tokens";
import { useActiveTimer } from "../timer/active-timer-provider";
import { WorklogForm } from "../worklogs/worklog-form";
import { JobActivity } from "./job-activity";
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
  const actions = useMemo(
    () =>
      createNativeActions({
        paymentsAppUrl: getMobileRuntimeConfig().paymentsAppUrl,
      }),
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<MobileJob | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const paymentOpeningRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    repository
      .getJob(jobId)
      .then((nextJob) => {
        if (!cancelled) {
          setJob(nextJob);
          setError(null);
          setRefreshMessage(nextJob.activityWarning);
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

  const refreshJob = async () => {
    setRefreshing(true);
    try {
      const nextJob = await repository.getJob(jobId);
      setJob(nextJob);
      setError(null);
      setRefreshMessage(nextJob.activityWarning);
    } catch {
      setRefreshMessage(
        "Could not refresh job activity. Showing the saved copy.",
      );
    } finally {
      setRefreshing(false);
    }
  };

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
  const hasPaymentContext = Boolean(job.requestNumber && job.customerName);

  const takePayment = async () => {
    if (!hasPaymentContext || paymentOpeningRef.current) {
      return;
    }

    paymentOpeningRef.current = true;
    try {
      const opened = await actions.takePayment({
        customerName: job.customerName,
        requestNumber: job.requestNumber,
      });
      if (!opened) {
        Alert.alert(
          "Payments app unavailable",
          "Install or update the EGIT Payments app, then try again.",
        );
      }
    } finally {
      paymentOpeningRef.current = false;
    }
  };

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            onRefresh={refreshJob}
            refreshing={refreshing}
            tintColor={colours.primary}
          />
        }
      >
        <Text style={styles.eyebrow}>{job.requestNumber ?? "Calendar event"}</Text>
        <Text accessibilityRole="header" style={styles.title}>
          {job.title}
        </Text>
        {readOnly ? <Text style={styles.readOnly}>Outlook Read Only</Text> : null}
        {timerMessage ? <Text style={styles.muted}>{timerMessage}</Text> : null}
        {refreshMessage ? (
          <Text accessibilityRole="alert" style={styles.refreshMessage}>
            {refreshMessage}
          </Text>
        ) : null}
        <JobCard job={job} />

        <Section title="Customer and site">
          <Detail label="Customer" value={job.customerName} />
          <Detail label="Site" value={job.siteName} />
          <Detail label="Address" value={job.siteAddress} />
          <Detail label="Contact" value={job.contactName} />
          <Detail label="Phone" value={job.contactPhone} />
          <Detail label="Email" value={job.contactEmail} />
        </Section>

        <Section title="Request description">
          <Text style={styles.description}>
            {job.description || "No request description has been recorded yet."}
          </Text>
        </Section>

        <Section title="Service context">
          <Detail label="Status" value={job.status} />
          <Detail label="Booking" value={job.bookingType} />
          <Detail label="SLA" value={job.slaDueAt} />
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
            {!hasPaymentContext ? (
              <Text style={styles.muted}>
                Payment needs a request number and customer name before it can
                open EGIT Payments.
              </Text>
            ) : null}
            <ActionButton
              disabled={!hasPaymentContext}
              label="Take payment"
              onPress={takePayment}
            />
          </View>
        </Section>

        {job.permissions.canWriteWorklog ? (
          <Section title="Work note">
            <WorklogForm job={job} technicianId={job.technician.id} />
          </Section>
        ) : null}

        <Section title="Job activity">
          <JobActivity entries={job.previousNotes} />
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
  description: {
    color: colours.text,
    fontSize: 15,
    lineHeight: 23,
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
  readOnly: {
    color: colours.outlook,
    fontSize: 14,
    fontWeight: "900",
  },
  refreshMessage: {
    backgroundColor: colours.surfaceRaised,
    borderColor: colours.primary,
    borderRadius: 12,
    borderWidth: 1,
    color: colours.text,
    fontSize: 14,
    lineHeight: 20,
    padding: 12,
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

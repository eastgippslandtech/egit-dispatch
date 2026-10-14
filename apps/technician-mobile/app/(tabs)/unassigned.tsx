import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { BookingType, MobileJob } from "../../src/contracts/mobile";
import { useTechnicianRepository } from "../../src/providers/app-providers";
import { colours } from "../../src/theme/tokens";

const BOOKING_TYPES: BookingType[] = ["Onsite", "Remote", "In house"];

export default function UnassignedRoute() {
  const repository = useTechnicianRepository();
  const [jobs, setJobs] = useState<MobileJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [date, setDate] = useState(todayKey());
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [bookingType, setBookingType] = useState<BookingType>("Onsite");
  const [submitting, setSubmitting] = useState(false);
  const claimSequence = useRef(0);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      setJobs(await repository.listUnassignedJobs());
    } catch (loadError) {
      setError(message(loadError, "Unassigned jobs could not be loaded."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [repository]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  async function handleSchedule(job: MobileJob) {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    claimSequence.current += 1;
    try {
      await repository.scheduleUnassignedJob({
        bookingType,
        clientMutationId: `mobile-claim-${job.id}-${claimSequence.current}`,
        date,
        end,
        jobId: job.id,
        start,
      });
      setJobs((current) => current.filter((candidate) => candidate.id !== job.id));
      setSelectedJobId(null);
      setNotice(`${job.requestNumber ?? "Request"} scheduled to your work.`);
    } catch (scheduleError) {
      setError(message(scheduleError, "This request could not be scheduled."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>Available requests</Text>
        <Text style={styles.title}>Unassigned</Text>
        <Text style={styles.subtitle}>
          Choose a request, then take it and schedule it into your own work.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh unassigned jobs"
          onPress={() => void refresh()}
          style={styles.refreshButton}
        >
          <Text style={styles.refreshText}>{refreshing ? "Refreshing…" : "Refresh queue"}</Text>
        </Pressable>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
        {loading ? <ActivityIndicator color={colours.primary} /> : null}
        {!loading && !jobs.length && !error ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Queue is clear</Text>
            <Text style={styles.subtitle}>There are no unassigned requests available right now.</Text>
          </View>
        ) : null}
        {jobs.map((job) => {
          const expanded = selectedJobId === job.id;
          return (
            <View key={job.id} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.requestNumber}>{job.requestNumber ?? "Request"}</Text>
                <Text style={priorityStyle(job.priority)}>{job.priority ?? "Normal"}</Text>
              </View>
              <Text style={styles.jobTitle}>{job.title}</Text>
              <Text style={styles.meta}>
                {[job.customerName, job.siteName ?? job.siteTown].filter(Boolean).join(" · ") || "Customer/site details unavailable"}
              </Text>
              {job.description ? <Text style={styles.description}>{job.description}</Text> : null}
              {job.slaDueAt ? <Text style={styles.meta}>Due {formatDate(job.slaDueAt)}</Text> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${expanded ? "Cancel scheduling" : "Take and schedule"} ${job.requestNumber ?? job.title}`}
                disabled={submitting}
                onPress={() => setSelectedJobId(expanded ? null : job.id)}
                style={[styles.primaryButton, submitting && styles.disabled]}
              >
                <Text style={styles.primaryText}>{expanded ? "Cancel" : "Take & schedule"}</Text>
              </Pressable>
              {expanded ? (
                <View style={styles.form}>
                  <Text style={styles.formTitle}>Schedule for yourself</Text>
                  <Text style={styles.fieldLabel}>Date (YYYY-MM-DD)</Text>
                  <TextInput accessibilityLabel="Schedule date" value={date} onChangeText={setDate} style={styles.input} />
                  <View style={styles.timeRow}>
                    <View style={styles.timeField}>
                      <Text style={styles.fieldLabel}>Start</Text>
                      <TextInput accessibilityLabel="Start time" value={start} onChangeText={setStart} style={styles.input} />
                    </View>
                    <View style={styles.timeField}>
                      <Text style={styles.fieldLabel}>End</Text>
                      <TextInput accessibilityLabel="End time" value={end} onChangeText={setEnd} style={styles.input} />
                    </View>
                  </View>
                  <Text style={styles.fieldLabel}>Booking type</Text>
                  <View style={styles.typeRow}>
                    {BOOKING_TYPES.map((type) => (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: bookingType === type }}
                        key={type}
                        onPress={() => setBookingType(type)}
                        style={[styles.typeButton, bookingType === type && styles.typeSelected]}
                      >
                        <Text style={[styles.typeText, bookingType === type && styles.typeTextSelected]}>{type}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Confirm schedule for ${job.requestNumber ?? job.title}`}
                    disabled={submitting}
                    onPress={() => void handleSchedule(job)}
                    style={[styles.primaryButton, styles.confirmButton, submitting && styles.disabled]}
                  >
                    <Text style={styles.primaryText}>{submitting ? "Scheduling…" : "Take job and confirm schedule"}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function todayKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit", month: "2-digit", timeZone: "Australia/Melbourne", year: "numeric",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeZone: "Australia/Melbourne" }).format(date);
}

function message(value: unknown, fallback: string) {
  return value instanceof Error ? value.message : fallback;
}

function priorityStyle(priority: MobileJob["priority"]) {
  return [styles.priority, priority === "Critical" ? styles.critical : null];
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colours.canvas, flex: 1 },
  content: { gap: 12, padding: 18, paddingBottom: 32 },
  eyebrow: { color: colours.primary, fontSize: 12, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  title: { color: colours.text, fontSize: 30, fontWeight: "900" },
  subtitle: { color: colours.muted, fontSize: 14, lineHeight: 20 },
  refreshButton: { alignSelf: "flex-start", borderColor: colours.border, borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9 },
  refreshText: { color: colours.text, fontSize: 14, fontWeight: "800" },
  error: { color: colours.critical, fontWeight: "700" },
  notice: { backgroundColor: colours.low, borderRadius: 10, color: colours.text, fontWeight: "800", padding: 12 },
  empty: { alignItems: "center", borderColor: colours.border, borderRadius: 16, borderWidth: 1, gap: 8, marginTop: 20, padding: 24 },
  emptyTitle: { color: colours.text, fontSize: 18, fontWeight: "900" },
  card: { backgroundColor: colours.surface, borderColor: colours.border, borderRadius: 16, borderWidth: 1, gap: 9, padding: 15 },
  cardTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  requestNumber: { color: colours.primary, fontSize: 13, fontWeight: "900" },
  priority: { color: colours.muted, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  critical: { color: colours.critical },
  jobTitle: { color: colours.text, fontSize: 18, fontWeight: "900" },
  meta: { color: colours.muted, fontSize: 13, lineHeight: 19 },
  description: { color: colours.text, fontSize: 14, lineHeight: 20 },
  primaryButton: { alignItems: "center", backgroundColor: colours.primary, borderRadius: 11, justifyContent: "center", marginTop: 4, minHeight: 48, paddingHorizontal: 12 },
  primaryText: { color: colours.brandNavy, fontSize: 14, fontWeight: "900", textAlign: "center" },
  disabled: { opacity: 0.55 },
  form: { borderColor: colours.border, borderTopWidth: 1, gap: 9, marginTop: 6, paddingTop: 13 },
  formTitle: { color: colours.text, fontSize: 16, fontWeight: "900" },
  fieldLabel: { color: colours.muted, fontSize: 12, fontWeight: "800" },
  input: { backgroundColor: colours.canvas, borderColor: colours.border, borderRadius: 9, borderWidth: 1, color: colours.text, minHeight: 42, paddingHorizontal: 11 },
  timeRow: { flexDirection: "row", gap: 10 },
  timeField: { flex: 1, gap: 6 },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  typeButton: { borderColor: colours.border, borderRadius: 99, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  typeSelected: { backgroundColor: colours.primary, borderColor: colours.primary },
  typeText: { color: colours.text, fontSize: 12, fontWeight: "800" },
  typeTextSelected: { color: colours.brandNavy },
  confirmButton: { marginTop: 7 },
});

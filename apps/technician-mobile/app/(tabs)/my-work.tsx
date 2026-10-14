import { Link, type Href } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { MobileJob } from "../../src/contracts/mobile";
import { JobCard } from "../../src/features/jobs/job-card";
import { useSchedule } from "../../src/features/jobs/use-schedule";
import { shiftDateKey, todayDateKey } from "../../src/features/schedule/date-keys";
import { colours } from "../../src/theme/tokens";

export default function MyWorkRoute() {
  const today = todayDateKey();
  const [selectedSectionTitle, setSelectedSectionTitle] = useState<string | null>(
    null,
  );
  const schedule = useSchedule({
    from: shiftDateKey(today, -30),
    to: shiftDateKey(today, 90),
  });
  const sections = buildMyWorkSections(schedule.jobs, today);
  const selectedSection = useMemo(
    () =>
      selectedSectionTitle
        ? sections.find((section) => section.title === selectedSectionTitle) ?? null
        : null,
    [sections, selectedSectionTitle],
  );

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Assigned workload</Text>
        <Text style={styles.title}>My Work</Text>
        <Text style={styles.subtitle}>
          Jobs, calendar blocks, SLA risk, and waiting items.
        </Text>
        <Text style={styles.syncLine}>
          {syncLabel(schedule.connectionState, schedule.lastSyncedAt)}
        </Text>
      </View>

      {schedule.error ? <Text style={styles.error}>{schedule.error}</Text> : null}
      {schedule.loading ? (
        <ActivityIndicator color={colours.primary} />
      ) : selectedSection ? (
        <ScrollView contentContainerStyle={styles.sections}>
          <Pressable
            accessibilityLabel="Back to My Work cards"
            accessibilityRole="button"
            onPress={() => setSelectedSectionTitle(null)}
            style={styles.backButton}
          >
            <Text style={styles.backButtonText}>‹ My Work</Text>
          </Pressable>
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>{selectedSection.title} jobs</Text>
                <Text style={styles.emptyCopy}>
                  {selectedSection.jobs.length
                    ? "Related jobs in this workload group."
                    : selectedSection.emptyCopy}
                </Text>
              </View>
              <Text style={styles.sectionCount}>{selectedSection.jobs.length}</Text>
            </View>
            {selectedSection.jobs.length ? (
              selectedSection.jobs.map((job) => (
                <Link
                  asChild
                  href={`/job/${job.id}` as Href}
                  key={`${selectedSection.title}-${job.id}`}
                >
                  <Pressable
                    accessibilityLabel={`Open ${job.title}`}
                    accessibilityRole="button"
                    testID={`work-job-card-${selectedSection.title}-${job.id}`}
                  >
                    <JobCard compact job={job} />
                  </Pressable>
                </Link>
              ))
            ) : (
              <Text style={styles.emptyCopy}>{selectedSection.emptyCopy}</Text>
            )}
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.sections}>
          {sections.map((section) => (
            <Pressable
              accessibilityLabel={`Open ${section.title} jobs`}
              accessibilityRole="button"
              key={section.title}
              onPress={() => setSelectedSectionTitle(section.title)}
              style={styles.section}
            >
              <View style={styles.sectionHeader}>
                <View style={styles.sectionText}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  <Text style={styles.emptyCopy}>{section.emptyCopy}</Text>
                </View>
                <Text style={styles.sectionCount}>{section.jobs.length}</Text>
              </View>
              <Text style={styles.cardHint}>Tap to view related jobs</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function syncLabel(
  connectionState: "connected" | "connecting" | "error",
  lastSyncedAt: string | null,
) {
  if (connectionState === "error") return "Connection issue";
  if (connectionState === "connecting") return "Syncing with Command Centre…";
  return `Connected · Last sync ${formatSyncTime(lastSyncedAt)}`;
}

function formatSyncTime(value: string | null) {
  if (!value) return "not yet";
  return new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function buildMyWorkSections(jobs: MobileJob[], today: string) {
  const activeJobs = jobs.filter((job) => job.status !== "Completed");
  const assignedHelpdeskJobs = uniqueRequests(
    activeJobs.filter((job) => job.permissions.canWriteWorklog),
  );
  return [
    {
      emptyCopy: "No work is scheduled for today.",
      jobs: activeJobs.filter((job) => job.startAt.slice(0, 10) === today),
      title: "Today",
    },
    {
      emptyCopy: "No upcoming assigned jobs are waiting.",
      jobs: activeJobs.filter((job) => job.startAt.slice(0, 10) > today),
      title: "Upcoming",
    },
    {
      emptyCopy: "There is no active assigned work.",
      jobs: assignedHelpdeskJobs,
      title: "Assigned to me",
    },
    {
      emptyCopy: "No SLA risk items are currently assigned.",
      jobs: activeJobs.filter(
        (job) =>
          job.priority === "Critical" ||
          job.tags.some((tag) => tag.toLowerCase().includes("sla")) ||
          Boolean(job.slaDueAt),
      ),
      title: "SLA risk",
    },
    {
      emptyCopy: "Nothing is waiting on you right now.",
      jobs: activeJobs.filter((job) => job.status.startsWith("Waiting on")),
      title: "Waiting on me",
    },
    {
      emptyCopy: "No recently completed jobs in this range.",
      jobs: jobs.filter((job) => job.status === "Completed"),
      title: "Recently completed",
    },
  ];
}

function uniqueRequests(jobs: MobileJob[]) {
  const seen = new Set<string>();

  return jobs.filter((job) => {
    const key = job.requestNumber?.trim().toLowerCase() || job.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const styles = StyleSheet.create({
  backButton: {
    alignSelf: "flex-start",
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  backButtonText: {
    color: colours.text,
    fontSize: 14,
    fontWeight: "900",
  },
  cardHint: {
    color: colours.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  emptyCopy: {
    color: colours.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  error: {
    color: colours.critical,
    fontSize: 14,
    marginBottom: 12,
  },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  header: {
    marginBottom: 18,
  },
  screen: { backgroundColor: colours.canvas, flex: 1, padding: 20 },
  section: {
    backgroundColor: colours.surface,
    borderColor: colours.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  sectionCount: {
    backgroundColor: colours.surfaceWarm,
    borderColor: colours.borderWarm,
    borderRadius: 18,
    borderWidth: 1,
    color: colours.primary,
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 40,
    minWidth: 56,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 5,
    textAlign: "center",
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  sectionText: {
    flex: 1,
    gap: 6,
  },
  sectionTitle: {
    color: colours.text,
    fontSize: 20,
    fontWeight: "900",
  },
  sections: {
    gap: 14,
    paddingBottom: 28,
  },
  subtitle: {
    color: colours.muted,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 6,
  },
  syncLine: {
    color: colours.muted,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 8,
  },
  title: {
    color: colours.text,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: -0.6,
  },
});

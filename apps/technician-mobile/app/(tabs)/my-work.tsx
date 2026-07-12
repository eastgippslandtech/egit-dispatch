import { Link, type Href } from "expo-router";
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
import { todayDateKey } from "../../src/features/schedule/date-keys";
import { colours } from "../../src/theme/tokens";

export default function MyWorkRoute() {
  const today = todayDateKey();
  const schedule = useSchedule({ from: today, to: "2026-08-31" });
  const sections = buildSections(schedule.jobs, today);

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Assigned workload</Text>
        <Text style={styles.title}>My Work</Text>
        <Text style={styles.subtitle}>
          Jobs, calendar blocks, SLA risk, and waiting items.
        </Text>
      </View>

      {schedule.error ? <Text style={styles.error}>{schedule.error}</Text> : null}
      {schedule.loading ? (
        <ActivityIndicator color={colours.primary} />
      ) : (
        <ScrollView contentContainerStyle={styles.sections}>
          {sections.map((section) => (
            <View key={section.title} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <Text style={styles.sectionCount}>{section.jobs.length}</Text>
              </View>
              {section.jobs.length ? (
                section.jobs.map((job) => (
                  <Link
                    asChild
                    href={`/job/${job.id}` as Href}
                    key={`${section.title}-${job.id}`}
                  >
                    <Pressable
                      accessibilityLabel={`Open ${job.title}`}
                      accessibilityRole="button"
                      testID={`work-job-card-${section.title}-${job.id}`}
                    >
                      <JobCard compact job={job} />
                    </Pressable>
                  </Link>
                ))
              ) : (
                <Text style={styles.emptyCopy}>{section.emptyCopy}</Text>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function buildSections(jobs: MobileJob[], today: string) {
  const activeJobs = jobs.filter((job) => job.status !== "Completed");
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
      jobs: activeJobs,
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

const styles = StyleSheet.create({
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
  title: {
    color: colours.text,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: -0.6,
  },
});

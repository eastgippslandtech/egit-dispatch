import { Link, type Href } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { JobCard } from "../../src/features/jobs/job-card";
import { useSchedule } from "../../src/features/jobs/use-schedule";
import { colours } from "../../src/theme/tokens";

export default function TodayRoute() {
  const [selectedDate, setSelectedDate] = useState("2026-07-09");
  const schedule = useSchedule({ from: selectedDate, to: selectedDate });

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Field schedule</Text>
          <Text style={styles.title}>Today</Text>
          <Text style={styles.subtitle}>{displayDate(selectedDate)}</Text>
        </View>
        <View style={styles.dateControls}>
          <Pressable
            accessibilityLabel="Previous day"
            accessibilityRole="button"
            onPress={() => setSelectedDate(shiftDate(selectedDate, -1))}
            style={styles.dateButton}
          >
            <Text style={styles.dateButtonText}>‹</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Next day"
            accessibilityRole="button"
            onPress={() => setSelectedDate(shiftDate(selectedDate, 1))}
            style={styles.dateButton}
          >
            <Text style={styles.dateButtonText}>›</Text>
          </Pressable>
        </View>
      </View>

      {schedule.error ? <Text style={styles.error}>{schedule.error}</Text> : null}
      {schedule.loading ? (
        <ActivityIndicator color={colours.primary} />
      ) : (
        <FlatList
          data={schedule.jobs}
          keyExtractor={(job) => job.id}
          ListEmptyComponent={() => (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No field work scheduled</Text>
              <Text style={styles.emptyCopy}>
                There are no assigned jobs or Outlook blocks for this day.
              </Text>
            </View>
          )}
          refreshControl={
            <RefreshControl
              refreshing={schedule.refreshing}
              tintColor={colours.primary}
              onRefresh={schedule.refresh}
            />
          }
          renderItem={({ item }) => (
            <Link
              asChild
              href={`/job/${item.id}` as Href}
            >
              <Pressable
                accessibilityLabel={`Open ${item.title}`}
                accessibilityRole="button"
                testID={`job-card-${item.id}`}
              >
                <JobCard job={item} />
              </Pressable>
            </Link>
          )}
          contentContainerStyle={styles.listContent}
        />
      )}
    </SafeAreaView>
  );
}

function shiftDate(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00+10:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function displayDate(date: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    timeZone: "Australia/Melbourne",
    weekday: "long",
  }).format(new Date(`${date}T00:00:00+10:00`));
}

const styles = StyleSheet.create({
  dateButton: {
    alignItems: "center",
    backgroundColor: colours.surfaceRaised,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  dateButtonText: {
    color: colours.text,
    fontSize: 30,
    fontWeight: "700",
    lineHeight: 32,
  },
  dateControls: {
    flexDirection: "row",
    gap: 10,
  },
  emptyCopy: {
    color: colours.muted,
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
  },
  emptyState: {
    alignItems: "center",
    backgroundColor: colours.surface,
    borderColor: colours.border,
    borderRadius: 22,
    borderWidth: 1,
    gap: 8,
    padding: 24,
  },
  emptyTitle: {
    color: colours.text,
    fontSize: 18,
    fontWeight: "800",
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
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  listContent: {
    gap: 12,
    paddingBottom: 28,
  },
  screen: { backgroundColor: colours.canvas, flex: 1, padding: 20 },
  subtitle: {
    color: colours.muted,
    fontSize: 15,
    marginTop: 4,
  },
  title: {
    color: colours.text,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: -0.6,
  },
});

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
import {
  displayDateLabel,
  relativeDateTitle,
  shiftDateKey,
  todayDateKey,
} from "../../src/features/schedule/date-keys";
import { colours } from "../../src/theme/tokens";

export default function TodayRoute() {
  const today = todayDateKey();
  const [selectedDate, setSelectedDate] = useState(today);
  const schedule = useSchedule({ from: selectedDate, to: selectedDate });
  const isToday = selectedDate === today;

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Field schedule</Text>
          <Text style={styles.title}>{relativeDateTitle(selectedDate)}</Text>
          <Text style={styles.subtitle}>{displayDateLabel(selectedDate)}</Text>
          <Text style={styles.syncLine}>
            {syncLabel(schedule.connectionState, schedule.lastSyncedAt)}
          </Text>
        </View>
        <View style={styles.dateControls}>
          <Pressable
            accessibilityLabel="Previous day"
            accessibilityRole="button"
            onPress={() => setSelectedDate((date) => shiftDateKey(date, -1))}
            style={styles.dateButton}
          >
            <Text style={styles.dateButtonText}>‹</Text>
          </Pressable>
          {!isToday ? (
            <Pressable
              accessibilityLabel="Show today's schedule"
              accessibilityRole="button"
              onPress={() => setSelectedDate(todayDateKey())}
              style={styles.todayButton}
            >
              <Text style={styles.todayButtonText}>Today</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel="Next day"
            accessibilityRole="button"
            onPress={() => setSelectedDate((date) => shiftDateKey(date, 1))}
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
  syncLine: {
    color: colours.muted,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 6,
  },
  title: {
    color: colours.text,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: -0.6,
  },
  todayButton: {
    alignItems: "center",
    backgroundColor: colours.primary,
    borderRadius: 18,
    height: 44,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  todayButtonText: {
    color: colours.textOnWarm,
    fontSize: 14,
    fontWeight: "900",
  },
});

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

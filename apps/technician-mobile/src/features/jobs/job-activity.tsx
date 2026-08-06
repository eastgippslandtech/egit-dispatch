import { StyleSheet, Text, View } from "react-native";

import type { MobileJobNote } from "../../contracts/mobile";
import { colours } from "../../theme/tokens";

interface JobActivityProps {
  entries: MobileJobNote[];
}

const activityDateTimeFormatter = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "long",
  timeZone: "Australia/Melbourne",
  year: "numeric",
});

export function JobActivity({ entries }: JobActivityProps) {
  if (!entries.length) {
    return (
      <Text style={styles.muted}>
        No customer replies, internal notes or Work Logs have been recorded yet.
      </Text>
    );
  }

  return (
    <View style={styles.list}>
      {entries.map((entry) => (
        <View key={entry.id} style={styles.card}>
          <Text style={styles.label}>{activityLabel(entry)}</Text>
          <Text style={styles.meta}>{activityDetail(entry)}</Text>
          <Text style={styles.body}>{entry.body}</Text>
        </View>
      ))}
    </View>
  );
}

function activityLabel(entry: MobileJobNote) {
  const kind =
    entry.kind ??
    (entry.visibility === "external" ? "customer_reply" : "internal_note");

  switch (kind) {
    case "customer_reply":
      return "Customer reply";
    case "worklog":
      return "Work Log";
    default:
      return "Internal note";
  }
}

function activityDetail(entry: MobileJobNote) {
  const details = [entry.authorName, formatActivityTime(entry.createdAt)];

  if (entry.kind === "worklog") {
    if (entry.durationMinutes && entry.durationMinutes > 0) {
      details.push(`${entry.durationMinutes} min`);
    }
    if (entry.isBillable === true) {
      details.push("Billable");
    } else if (entry.isBillable === false) {
      details.push("Internal");
    }
  }

  return details.filter(Boolean).join(" · ");
}

function formatActivityTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : activityDateTimeFormatter.format(date);
}

const styles = StyleSheet.create({
  body: {
    color: colours.text,
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    backgroundColor: colours.surfaceRaised,
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  label: {
    color: colours.primary,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  list: {
    gap: 10,
  },
  meta: {
    color: colours.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  muted: {
    color: colours.muted,
    fontSize: 14,
    lineHeight: 20,
  },
});

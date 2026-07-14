import { StyleSheet, Text, View } from "react-native";

import type { MobileJob, MobilePriority } from "../../contracts/mobile";
import { colours } from "../../theme/tokens";

interface JobCardProps {
  job: MobileJob;
  compact?: boolean;
}

export function JobCard({ compact = false, job }: JobCardProps) {
  const readOnlyLabel = job.permissions.readOnlyReason
    ? "Outlook Read Only"
    : null;
  const priorityColour = colourForPriority(job.priority);
  const cardTone = cardToneForPriority(job.priority);

  return (
    <View
      accessibilityLabel={`${job.title} job card`}
      style={[styles.card, cardTone, compact && styles.compactCard]}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.time}>{timeRange(job)}</Text>
        <Text style={[styles.priority, { color: priorityColour }]}>
          {job.priority ?? "Calendar"}
        </Text>
      </View>

      <Text style={styles.title}>{job.title}</Text>
      <Text style={styles.meta}>{customerLine(job)}</Text>
      <Text style={styles.meta}>
        {job.bookingType} · {job.status}
      </Text>

      <View style={styles.badgeRow}>
        {readOnlyLabel ? (
          <View style={[styles.badge, styles.outlookBadge]}>
            <Text style={styles.badgeText}>{readOnlyLabel}</Text>
          </View>
        ) : null}
        {job.slaDueAt ? (
          <View style={[styles.badge, styles.slaBadge]}>
            <Text style={styles.badgeText}>SLA {shortDateTime(job.slaDueAt)}</Text>
          </View>
        ) : null}
        <View style={[styles.badge, styles.syncBadge]}>
          <Text style={styles.badgeText}>Sync {job.syncState}</Text>
        </View>
      </View>

      {job.travel ? (
        <Text style={styles.supporting}>
          Travel {job.travel.travelToSiteMinutes}m there ·{" "}
          {job.travel.travelBackToOfficeMinutes}m back
        </Text>
      ) : null}
      {job.permissions.readOnlyReason ? (
        <Text style={styles.supporting}>{job.permissions.readOnlyReason}</Text>
      ) : null}
    </View>
  );
}

function timeRange(job: MobileJob): string {
  return `${shortTime(job.startAt)}–${shortTime(job.endAt)}`;
}

function shortTime(value: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Australia/Melbourne",
  }).format(new Date(value));
}

function shortDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "Australia/Melbourne",
  }).format(new Date(value));
}

function customerLine(job: MobileJob): string {
  const site = job.siteName ?? job.siteTown ?? "No site";
  return job.customerName ? `${job.customerName} · ${site}` : site;
}

function colourForPriority(priority: MobilePriority | null): string {
  switch (priority) {
    case "Critical":
      return colours.critical;
    case "High":
      return colours.high;
    case "Medium":
      return colours.medium;
    case "Low":
      return colours.low;
    default:
      return colours.outlook;
  }
}

function cardToneForPriority(priority: MobilePriority | null) {
  switch (priority) {
    case "Critical":
      return styles.criticalCard;
    case "High":
      return styles.highCard;
    case "Medium":
      return styles.mediumCard;
    case "Low":
      return styles.lowCard;
    default:
      return styles.outlookCard;
  }
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  badgeText: {
    color: colours.text,
    fontSize: 12,
    fontWeight: "700",
  },
  card: {
    backgroundColor: colours.surfaceRaised,
    borderColor: colours.border,
    borderRadius: 22,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  cardHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  compactCard: {
    padding: 14,
  },
  criticalCard: {
    backgroundColor: "rgba(242, 31, 49, 0.28)",
    borderColor: "rgba(251, 113, 133, 0.72)",
  },
  highCard: {
    backgroundColor: "rgba(245, 158, 11, 0.24)",
    borderColor: "rgba(251, 191, 36, 0.72)",
  },
  lowCard: {
    backgroundColor: "rgba(14, 165, 233, 0.22)",
    borderColor: "rgba(56, 189, 248, 0.68)",
  },
  meta: {
    color: colours.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  outlookBadge: {
    backgroundColor: colours.outlook,
  },
  outlookCard: {
    backgroundColor: colours.surfaceRaised,
    borderColor: colours.border,
  },
  priority: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  mediumCard: {
    backgroundColor: "rgba(16, 185, 129, 0.22)",
    borderColor: "rgba(52, 211, 153, 0.68)",
  },
  slaBadge: {
    backgroundColor: colours.borderWarm,
  },
  supporting: {
    color: colours.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  syncBadge: {
    backgroundColor: colours.surfaceWarm,
    borderColor: colours.borderWarm,
    borderWidth: 1,
  },
  time: {
    color: colours.primary,
    fontSize: 13,
    fontWeight: "800",
  },
  title: {
    color: colours.text,
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 25,
  },
});

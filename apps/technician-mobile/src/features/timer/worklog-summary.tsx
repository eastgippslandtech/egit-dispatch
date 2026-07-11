import { StyleSheet, Text, View } from "react-native";

import type { NoteVisibility, StoppedTimer } from "../../contracts/mobile";
import { colours } from "../../theme/tokens";
import { roundWorklogMinutes } from "./timer-service";

export function createWorklogSummary({
  note,
  stoppedTimer,
  visibility,
}: {
  note: string;
  stoppedTimer: StoppedTimer;
  visibility: NoteVisibility;
}) {
  return {
    durationMinutes: roundWorklogMinutes(stoppedTimer.actualElapsedMinutes),
    note: note.trim(),
    timerSessionId: stoppedTimer.id,
    visibility,
  };
}

export function WorklogSummary({
  note,
  stoppedTimer,
  visibility,
}: {
  note: string;
  stoppedTimer: StoppedTimer;
  visibility: NoteVisibility;
}) {
  const summary = createWorklogSummary({ note, stoppedTimer, visibility });
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Worklog summary</Text>
      <Text style={styles.line}>Actual: {stoppedTimer.actualElapsedMinutes}m</Text>
      <Text style={styles.line}>Rounded: {summary.durationMinutes}m</Text>
      <Text style={styles.line}>Visibility: {visibility}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colours.surface,
    borderRadius: 20,
    gap: 6,
    padding: 16,
  },
  line: {
    color: colours.muted,
    fontSize: 14,
  },
  title: {
    color: colours.text,
    fontSize: 18,
    fontWeight: "900",
  },
});

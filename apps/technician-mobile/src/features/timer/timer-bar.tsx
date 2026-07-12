import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ActiveTimer } from "../../contracts/mobile";
import { colours } from "../../theme/tokens";
import { elapsedSeconds } from "./timer-service";

export function TimerBar({
  jobTitle,
  now,
  onStop,
  timer,
}: {
  jobTitle: string;
  now: Date;
  onStop: () => void;
  timer: ActiveTimer;
}) {
  const [currentTime, setCurrentTime] = useState(now);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1_000);

    return () => {
      clearInterval(interval);
    };
  }, [timer.id, timer.startedAt]);

  return (
    <View style={styles.bar}>
      <View>
        <Text style={styles.label}>Timer running</Text>
        <Text style={styles.title}>{jobTitle}</Text>
        <Text style={styles.elapsed}>
          {formatElapsed(elapsedSeconds(timer, currentTime))}
        </Text>
      </View>
      <Pressable
        accessibilityLabel="Stop timer"
        accessibilityRole="button"
        onPress={onStop}
        style={styles.stopButton}
      >
        <Text style={styles.stopText}>Stop</Text>
      </Pressable>
    </View>
  );
}

function formatElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    backgroundColor: colours.surfaceWarm,
    borderColor: colours.borderWarm,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 14,
  },
  elapsed: {
    color: colours.primary,
    fontSize: 18,
    fontWeight: "900",
  },
  label: {
    color: colours.muted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  stopButton: {
    backgroundColor: colours.critical,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  stopText: {
    color: colours.text,
    fontWeight: "900",
  },
  title: {
    color: colours.text,
    fontSize: 15,
    fontWeight: "800",
  },
});

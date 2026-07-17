import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppButton } from "../../components/app-button";
import type { ActiveTimer } from "../../contracts/mobile";
import { colours } from "../../theme/tokens";
import {
  TIMER_BANNER_VERTICAL_PADDING,
  topCutoutPadding,
} from "./timer-banner-layout";
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
  const insets = useSafeAreaInsets();
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
    <View
      style={[
        styles.bar,
        { paddingTop: topCutoutPadding(insets.top, TIMER_BANNER_VERTICAL_PADDING) },
      ]}
    >
      <View>
        <Text style={styles.label}>Timer running</Text>
        <Text style={styles.title}>{jobTitle}</Text>
        <Text style={styles.elapsed}>
          {formatElapsed(elapsedSeconds(timer, currentTime))}
        </Text>
      </View>
      <AppButton
        accessibilityLabel="Stop timer"
        label="Stop"
        onPress={onStop}
        variant="navy"
      />
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
    backgroundColor: colours.primary,
    borderBottomColor: colours.borderWarm,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 14,
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: TIMER_BANNER_VERTICAL_PADDING,
  },
  elapsed: {
    color: colours.brandNavy,
    fontSize: 24,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  label: {
    color: colours.brandNavy,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    color: colours.brandNavy,
    fontSize: 15,
    fontWeight: "900",
  },
});

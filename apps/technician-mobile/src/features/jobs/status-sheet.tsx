import { Pressable, StyleSheet, Text, View } from "react-native";

import type { MobileJobStatus } from "../../contracts/mobile";
import { colours } from "../../theme/tokens";
import { allowedJobStatuses } from "../worklogs/worklog-service";

export function StatusSheet({
  onSelect,
}: {
  onSelect: (status: MobileJobStatus) => void;
}) {
  return (
    <View style={styles.sheet}>
      <Text style={styles.title}>Update status</Text>
      {allowedJobStatuses.map((status) => (
        <Pressable
          accessibilityLabel={`Set status ${status}`}
          accessibilityRole="button"
          key={status}
          onPress={() => onSelect(status)}
          style={styles.option}
        >
          <Text style={styles.optionText}>{status}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  option: {
    backgroundColor: colours.surfaceRaised,
    borderRadius: 12,
    padding: 12,
  },
  optionText: {
    color: colours.text,
    fontWeight: "800",
  },
  sheet: {
    gap: 8,
  },
  title: {
    color: colours.text,
    fontSize: 18,
    fontWeight: "900",
  },
});

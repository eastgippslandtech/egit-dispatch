import { StyleSheet, Text, View } from "react-native";

import { colours } from "../../theme/tokens";
import type { StagedEvidence } from "./evidence-service";

export function EvidenceList({ items }: { items: StagedEvidence[] }) {
  return (
    <View style={styles.list}>
      <Text style={styles.title}>Evidence</Text>
      {items.length ? (
        items.map((item) => (
          <View key={item.id} style={styles.item}>
            <Text style={styles.name}>{item.fileName}</Text>
            <Text style={styles.meta}>
              {item.kind} · {item.state} · {item.progress}%
            </Text>
            {item.lastError ? <Text style={styles.error}>{item.lastError}</Text> : null}
          </View>
        ))
      ) : (
        <Text style={styles.meta}>No evidence staged.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  error: { color: colours.critical, fontSize: 13 },
  item: {
    backgroundColor: colours.surfaceRaised,
    borderRadius: 14,
    gap: 4,
    padding: 12,
  },
  list: { gap: 10 },
  meta: { color: colours.muted, fontSize: 13 },
  name: { color: colours.text, fontSize: 15, fontWeight: "800" },
  title: { color: colours.text, fontSize: 18, fontWeight: "900" },
});

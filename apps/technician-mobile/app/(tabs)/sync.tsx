import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colours } from "../../src/theme/tokens";

export default function SyncRoute() {
  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
      <Text style={styles.eyebrow}>Offline workspace</Text>
      <Text style={styles.title}>Ready when the network is not.</Text>
      <Text style={styles.copy}>
        Jobs are cached locally, work notes are queued with safe retry keys, and
        failed sync items stay visible until they are sent.
      </Text>

      <View style={styles.grid}>
        <SyncTile label="Cached jobs" value="Available" tone="ok" />
        <SyncTile label="Pending changes" value="Queued" tone="warn" />
        <SyncTile label="Failed items" value="Retryable" tone="danger" />
        <SyncTile label="Last sync" value="Local demo" tone="ok" />
      </View>
    </SafeAreaView>
  );
}

function SyncTile({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "danger" | "ok" | "warn";
  value: string;
}) {
  return (
    <View style={[styles.tile, styles[tone]]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  copy: { color: colours.muted, fontSize: 15, lineHeight: 22, marginTop: 10 },
  danger: { borderColor: "#ef4444" },
  eyebrow: {
    color: colours.primary,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  grid: { gap: 12, marginTop: 24 },
  ok: { borderColor: "#22c55e" },
  screen: { backgroundColor: colours.canvas, flex: 1, padding: 20 },
  tile: {
    backgroundColor: colours.surface,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  tileLabel: { color: colours.muted, fontSize: 13, fontWeight: "700" },
  tileValue: { color: colours.text, fontSize: 20, fontWeight: "900", marginTop: 6 },
  title: { color: colours.text, fontSize: 30, fontWeight: "900", marginTop: 8 },
  warn: { borderColor: colours.primary },
});

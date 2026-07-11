import * as Location from "expo-location";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colours } from "../../theme/tokens";
import { createEtaService, openPreferredMaps } from "./eta-service";

export function EtaPanel({
  address,
  fallbackMinutes,
}: {
  address: string;
  fallbackMinutes: number;
}) {
  const [message, setMessage] = useState<string | null>(null);

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>ETA</Text>
      <Pressable
        accessibilityLabel="Calculate ETA"
        accessibilityRole="button"
        onPress={() => {
          const service = createEtaService({
            location: {
              getCurrentPosition: () => Location.getCurrentPositionAsync(),
              requestForegroundPermissions: () =>
                Location.requestForegroundPermissionsAsync(),
            },
          });
          void service
            .calculate({
              destinationAddress: address,
              travelMinutesFallback: fallbackMinutes,
            })
            .then((result) => setMessage(result.display));
        }}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Calculate ETA</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Open in Maps"
        accessibilityRole="button"
        onPress={() => void openPreferredMaps(address)}
        style={styles.secondary}
      >
        <Text style={styles.secondaryText}>Open in Maps</Text>
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: colours.primary, borderRadius: 14, padding: 14 },
  buttonText: { color: colours.textOnWarm, fontWeight: "900", textAlign: "center" },
  message: { color: colours.muted },
  panel: { gap: 10 },
  secondary: {
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  secondaryText: { color: colours.text, fontWeight: "900", textAlign: "center" },
  title: { color: colours.text, fontSize: 18, fontWeight: "900" },
});

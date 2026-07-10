import { StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colours } from "../../src/theme/tokens";

export default function ProfileRoute() {
  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
      <Text style={styles.placeholder}>Profile workspace</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  placeholder: { color: colours.muted, fontSize: 16 },
  screen: { backgroundColor: colours.canvas, flex: 1, padding: 20 },
});

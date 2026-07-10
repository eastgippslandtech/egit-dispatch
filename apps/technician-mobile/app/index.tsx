import { StyleSheet, Text, View } from "react-native";

export default function IndexRoute() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Command Centre</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: "#09090b",
    flex: 1,
    justifyContent: "center",
  },
  title: {
    color: "#fafafa",
    fontSize: 24,
    fontWeight: "600",
  },
});

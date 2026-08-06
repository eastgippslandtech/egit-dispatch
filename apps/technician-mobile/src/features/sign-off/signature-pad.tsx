import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colours } from "../../theme/tokens";

export function SignaturePad({
  points,
}: {
  points: readonly { x: number; y: number }[];
}) {
  const path = useMemo(() => {
    const nextPath = Skia.Path.Make();
    points.forEach((point, index) => {
      if (index === 0) nextPath.moveTo(point.x, point.y);
      else nextPath.lineTo(point.x, point.y);
    });
    return nextPath;
  }, [points]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Signature</Text>
      <Canvas style={styles.canvas}>
        <Path color={colours.text} path={path} strokeWidth={3} style="stroke" />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    height: 160,
  },
  label: {
    color: colours.text,
    fontWeight: "900",
  },
  wrap: {
    gap: 8,
  },
});
